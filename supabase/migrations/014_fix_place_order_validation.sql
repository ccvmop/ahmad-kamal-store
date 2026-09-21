-- Migration 014: Harden place_order RPC with server-side validation
--
-- What changed from 013:
--   - Price: reads real price from products/variants, never trusts client
--   - Products: validates product UUID exists and is active
--   - Variants: validates variant UUID exists (with legacy_id fallback), is active, belongs to product
--   - Stock: checks stock availability, decrements atomically
--   - Offers: applies best active offer server-side
--   - Coupon: validates expiry, min_order, max_uses, increments usage
--   - Delivery: looks up delivery_areas by city name, checks free_shipping_threshold
--   - Totals: computes subtotal, discount, shipping, total from server-side data
--   - Atomicity: order + items + stock in single transaction
--
-- Function signature is UNCHANGED — storefront.js RPC call works without modification.
-- SECURITY DEFINER + SET search_path = '' preserved.
-- Schema-qualified table names (public.*) used throughout.

DROP FUNCTION IF EXISTS public.place_order(
  text, text, text, text, jsonb,
  numeric, numeric, numeric, numeric,
  text, text, text
);

CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_city    text,
  p_customer_address text,
  p_items            jsonb,      -- [{product_id, variant_id, product_name, variant, qty, price, image, options}]
  p_subtotal         numeric,
  p_discount         numeric,
  p_shipping_cost    numeric,
  p_total            numeric,
  p_notes            text,
  p_payment_method   text,
  p_coupon_code      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_id      uuid;
  v_order_number  text;
  v_coupon_id     uuid;
  v_coupon_rec    record;
  v_discount      numeric := 0;
  v_subtotal      numeric := 0;
  v_shipping      numeric := 0;
  v_total         numeric := 0;
  v_item          jsonb;
  v_product       record;
  v_variant       record;
  v_unit_price    numeric;
  v_line_total    numeric;
  v_qty           int;
  v_offer         record;
  v_offer_price   numeric;
  v_offer_disc    numeric;
  v_result        jsonb;
BEGIN
  -- ── Validate inputs ──────────────────────────────────────
  IF p_customer_name IS NULL OR length(trim(p_customer_name)) = 0 THEN
    RAISE EXCEPTION 'customer_name is required';
  END IF;
  IF p_customer_phone IS NULL OR length(trim(p_customer_phone)) = 0 THEN
    RAISE EXCEPTION 'customer_phone is required';
  END IF;
  IF p_customer_address IS NULL OR length(trim(p_customer_address)) = 0 THEN
    RAISE EXCEPTION 'customer_address is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  -- ── Generate order number ────────────────────────────────
  v_order_number := public.next_order_number();

  -- ── Resolve coupon (server-side, ignore client discount) ─
  v_coupon_id := NULL;
  v_discount := 0;
  IF p_coupon_code IS NOT NULL AND length(trim(p_coupon_code)) > 0 THEN
    SELECT c.id, c.discount_type, c.value, c.min_order, c.max_uses, c.used, c.expires_at, c.active
    INTO v_coupon_rec
    FROM public.coupons c
    WHERE c.code = trim(p_coupon_code)
    LIMIT 1;

    IF v_coupon_rec.id IS NOT NULL THEN
      IF v_coupon_rec.active IS NOT TRUE THEN
        RAISE EXCEPTION 'Coupon is not active';
      END IF;
      IF v_coupon_rec.expires_at IS NOT NULL AND v_coupon_rec.expires_at < now() THEN
        RAISE EXCEPTION 'Coupon has expired';
      END IF;
      IF v_coupon_rec.max_uses > 0 AND v_coupon_rec.used >= v_coupon_rec.max_uses THEN
        RAISE EXCEPTION 'Coupon usage limit reached';
      END IF;
      v_coupon_id := v_coupon_rec.id;
    END IF;
  END IF;

  -- ── Validate items, compute real subtotal & discount ─────
  FOR v_item IN SELECT jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'qty')::int, 1);
    IF v_qty < 1 THEN v_qty := 1; END IF;

    -- Look up product by UUID
    SELECT id, price, stock, active
    INTO v_product
    FROM public.products
    WHERE id = NULLIF(v_item->>'product_id', '')::uuid;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id';
    END IF;
    IF v_product.active IS NOT TRUE THEN
      RAISE EXCEPTION 'Product is not available: %', COALESCE(v_item->>'product_name', v_item->>'product_id');
    END IF;

    -- Check stock at product level
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%": requested %, available %',
        COALESCE(v_item->>'product_name', ''), v_qty, v_product.stock;
    END IF;

    -- Resolve variant (try UUID first, then legacy_id fallback)
    v_variant := NULL;
    IF v_item->>'variant_id' IS NOT NULL AND length(v_item->>'variant_id') > 0 THEN
      -- Try UUID first
      SELECT id, price, stock, active, product_id
      INTO v_variant
      FROM public.product_variants
      WHERE id = NULLIF(v_item->>'variant_id', '')::uuid;

      -- Fallback: try legacy_id
      IF v_variant IS NULL THEN
        SELECT id, price, stock, active, product_id
        INTO v_variant
        FROM public.product_variants
        WHERE legacy_id = v_item->>'variant_id';
      END IF;

      IF v_variant IS NULL THEN
        RAISE EXCEPTION 'Variant not found: %', v_item->>'variant_id';
      END IF;
      IF v_variant.active IS NOT TRUE THEN
        RAISE EXCEPTION 'Variant is not available';
      END IF;
      IF v_variant.product_id != v_product.id THEN
        RAISE EXCEPTION 'Variant does not belong to product';
      END IF;
      IF v_variant.stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient variant stock: requested %, available %', v_qty, v_variant.stock;
      END IF;
    END IF;

    -- Compute unit price from DB (ignore client price)
    IF v_variant IS NOT NULL AND v_variant.price > 0 THEN
      v_unit_price := v_variant.price;
    ELSE
      v_unit_price := v_product.price;
    END IF;

    -- Apply best active offer server-side
    SELECT o.id, o.discount_type, o.discount_value
    INTO v_offer
    FROM public.offers o
    WHERE o.active IS TRUE
      AND o.starts_at <= now()
      AND o.ends_at >= now()
      AND (
        (o.target_type = 'product' AND o.target_id = v_product.id)
        OR
        (o.target_type = 'category' AND o.target_id = (SELECT category_id FROM public.products WHERE id = v_product.id))
      )
    ORDER BY
      CASE o.discount_type
        WHEN 'percent' THEN v_unit_price * o.discount_value / 100
        ELSE o.discount_value
      END DESC
    LIMIT 1;

    IF v_offer.id IS NOT NULL THEN
      IF v_offer.discount_type = 'percent' THEN
        v_offer_price := GREATEST(0, v_unit_price - (v_unit_price * v_offer.discount_value / 100));
      ELSE
        v_offer_price := GREATEST(0, v_unit_price - v_offer.discount_value);
      END IF;
      v_offer_disc := v_unit_price - v_offer_price;
      v_discount := v_discount + (v_offer_disc * v_qty);
      v_unit_price := v_offer_price;
    END IF;

    v_line_total := v_unit_price * v_qty;
    v_subtotal := v_subtotal + (v_product.price * v_qty);
  END LOOP;

  -- ── Apply coupon discount on subtotal (matches client behavior) ─
  IF v_coupon_rec.id IS NOT NULL THEN
    IF v_coupon_rec.min_order > 0 AND v_subtotal < v_coupon_rec.min_order THEN
      RAISE EXCEPTION 'Minimum order for coupon is %', v_coupon_rec.min_order;
    END IF;
    IF v_coupon_rec.discount_type = 'percent' THEN
      v_discount := v_discount + (v_subtotal * v_coupon_rec.value / 100);
    ELSE
      v_discount := v_discount + v_coupon_rec.value;
    END IF;
  END IF;

  -- ── Compute shipping from delivery_areas ─────────────────
  IF p_customer_city IS NOT NULL AND length(trim(p_customer_city)) > 0 THEN
    SELECT shipping_cost INTO v_shipping
    FROM public.delivery_areas
    WHERE name = trim(p_customer_city)
      AND active IS TRUE
    LIMIT 1;
  END IF;
  IF v_shipping IS NULL THEN v_shipping := 0; END IF;

  -- Free shipping threshold
  DECLARE
    v_free_threshold numeric;
  BEGIN
    SELECT free_shipping_threshold INTO v_free_threshold
    FROM public.settings WHERE id = 1;
    IF v_free_threshold IS NOT NULL AND v_free_threshold > 0 AND v_subtotal >= v_free_threshold THEN
      v_shipping := 0;
    END IF;
  END;

  -- Cap discount at subtotal
  IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;

  -- Compute total
  v_total := v_subtotal - v_discount + v_shipping;
  IF v_total < 0 THEN v_total := 0; END IF;

  -- ── Insert order ─────────────────────────────────────────
  INSERT INTO public.orders (
    order_number,
    customer_name,
    customer_phone,
    customer_city,
    customer_address,
    subtotal,
    discount,
    shipping_cost,
    total,
    coupon_id,
    coupon_code,
    notes,
    payment_method,
    status
  ) VALUES (
    v_order_number,
    trim(p_customer_name),
    trim(p_customer_phone),
    trim(p_customer_city),
    trim(p_customer_address),
    v_subtotal,
    v_discount,
    v_shipping,
    v_total,
    v_coupon_id,
    CASE WHEN v_coupon_id IS NOT NULL THEN trim(p_coupon_code) ELSE NULL END,
    p_notes,
    COALESCE(p_payment_method, 'cod'),
    'ordered'
  )
  RETURNING id INTO v_order_id;

  -- ── Insert order items (with server-side prices) ─────────
  FOR v_item IN SELECT jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'qty')::int, 1);
    IF v_qty < 1 THEN v_qty := 1; END IF;

    -- Re-read product (already validated above, read-only here)
    SELECT id, price INTO v_product
    FROM public.products
    WHERE id = NULLIF(v_item->>'product_id', '')::uuid;

    -- Re-read variant (try UUID then legacy_id)
    v_variant := NULL;
    IF v_item->>'variant_id' IS NOT NULL AND length(v_item->>'variant_id') > 0 THEN
      SELECT id, price INTO v_variant
      FROM public.product_variants
      WHERE id = NULLIF(v_item->>'variant_id', '')::uuid;
      IF v_variant IS NULL THEN
        SELECT id, price INTO v_variant
        FROM public.product_variants
        WHERE legacy_id = v_item->>'variant_id';
      END IF;
    END IF;

    -- Unit price from DB
    IF v_variant IS NOT NULL AND v_variant.price > 0 THEN
      v_unit_price := v_variant.price;
    ELSE
      v_unit_price := v_product.price;
    END IF;

    -- Apply best offer (same logic as above)
    SELECT o.id, o.discount_type, o.discount_value
    INTO v_offer
    FROM public.offers o
    WHERE o.active IS TRUE
      AND o.starts_at <= now()
      AND o.ends_at >= now()
      AND (
        (o.target_type = 'product' AND o.target_id = v_product.id)
        OR
        (o.target_type = 'category' AND o.target_id = (SELECT category_id FROM public.products WHERE id = v_product.id))
      )
    ORDER BY
      CASE o.discount_type
        WHEN 'percent' THEN v_unit_price * o.discount_value / 100
        ELSE o.discount_value
      END DESC
    LIMIT 1;

    IF v_offer.id IS NOT NULL THEN
      IF v_offer.discount_type = 'percent' THEN
        v_unit_price := GREATEST(0, v_unit_price - (v_unit_price * v_offer.discount_value / 100));
      ELSE
        v_unit_price := GREATEST(0, v_unit_price - v_offer.discount_value);
      END IF;
    END IF;

    v_line_total := v_unit_price * v_qty;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_label_snapshot,
      image_snapshot,
      unit_price,
      qty,
      line_total,
      options_snapshot,
      display_order
    ) VALUES (
      v_order_id,
      v_product.id,
      CASE WHEN v_variant IS NOT NULL THEN v_variant.id ELSE NULL END,
      COALESCE(v_item->>'product_name', 'منتج'),
      v_item->>'variant',
      v_item->>'image',
      v_unit_price,
      v_qty,
      v_line_total,
      COALESCE(v_item->'options', '[]'::jsonb),
      COALESCE((v_item->>'display_order')::int, 0)
    );

    -- Decrement product stock
    UPDATE public.products
    SET stock = GREATEST(0, stock - v_qty)
    WHERE id = v_product.id;

    -- Decrement variant stock if exists
    IF v_variant IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = GREATEST(0, stock - v_qty)
      WHERE id = v_variant.id;
    END IF;
  END LOOP;

  -- ── Finalize coupon usage ────────────────────────────────
  IF v_coupon_id IS NOT NULL THEN
    UPDATE public.coupons SET used = used + 1 WHERE id = v_coupon_id;
  END IF;

  -- ── Update order with final computed values ──────────────
  UPDATE public.orders
  SET subtotal     = v_subtotal,
      discount     = v_discount,
      shipping_cost = v_shipping,
      total        = v_total,
      coupon_id    = v_coupon_id,
      coupon_code  = CASE WHEN v_coupon_id IS NOT NULL THEN trim(p_coupon_code) ELSE NULL END
  WHERE id = v_order_id;

  -- ── Return result ────────────────────────────────────────
  v_result := jsonb_build_object(
    'id',           v_order_id,
    'order_number', v_order_number
  );

  RETURN v_result;
END;
$$;

-- ── Grants ────────────────────────────────────────────────
-- Same as 013: only anon can execute.
REVOKE EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, jsonb,
  numeric, numeric, numeric, numeric,
  text, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, jsonb,
  numeric, numeric, numeric, numeric,
  text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, jsonb,
  numeric, numeric, numeric, numeric,
  text, text, text
) TO anon;
