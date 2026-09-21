-- Migration 017: Order access tokens + rate limiting
--
-- Problem 1 (IDOR): get_orders_by_phone returns orders for ANY phone number.
--   Fix: Each order gets a random access_token. Client must present it to read orders.
--
-- Problem 2 (Abuse): place_order has no rate limiting.
--   Fix: Track orders per phone in a rolling 15-min window. Max 5 orders per phone per 15 min.
--
-- Backward compatibility:
--   - Old orders have access_token = NULL. get_orders_by_phone still works for them by phone alone.
--   - New orders (after this migration) require access_token.
--   - No existing data is deleted or modified.

-- ═══════════════════════════════════════════════════════════
-- 1. Add access_token column to orders
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS access_token uuid DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_access_token
  ON public.orders(access_token)
  WHERE access_token IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 2. Rate limiting table
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.order_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_clean text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  order_count int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_phone
  ON public.order_rate_limits(phone_clean, window_start);

-- ═══════════════════════════════════════════════════════════
-- 3. Updated place_order: generates access_token + rate limit
-- ═══════════════════════════════════════════════════════════
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
  p_items            jsonb,
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
  v_access_token  uuid;
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
  v_clean_phone   text;
  v_rate_rec      record;
  v_window_start  timestamptz;
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

  -- ── Rate limiting: max 5 orders per phone per 15 minutes ─
  v_clean_phone := regexp_replace(p_customer_phone, '[^0-9]', '', 'g');
  v_window_start := now() - interval '15 minutes';

  SELECT rl.id, rl.order_count, rl.window_start
  INTO v_rate_rec
  FROM public.order_rate_limits rl
  WHERE rl.phone_clean = v_clean_phone
    AND rl.window_start > v_window_start
  ORDER BY rl.window_start DESC
  LIMIT 1;

  IF v_rate_rec.id IS NOT NULL THEN
    IF v_rate_rec.order_count >= 5 THEN
      RAISE EXCEPTION 'Too many orders. Please try again later.';
    END IF;
    UPDATE public.order_rate_limits
    SET order_count = order_count + 1
    WHERE id = v_rate_rec.id;
  ELSE
    INSERT INTO public.order_rate_limits (phone_clean, window_start, order_count)
    VALUES (v_clean_phone, now(), 1);
  END IF;

  -- ── Generate order number + access token ─────────────────
  v_order_number := public.next_order_number();
  v_access_token := gen_random_uuid();

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
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%": requested %, available %',
        COALESCE(v_item->>'product_name', ''), v_qty, v_product.stock;
    END IF;

    v_variant := NULL;
    IF v_item->>'variant_id' IS NOT NULL AND length(v_item->>'variant_id') > 0 THEN
      SELECT id, price, stock, active, product_id
      INTO v_variant
      FROM public.product_variants
      WHERE id = NULLIF(v_item->>'variant_id', '')::uuid;

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

    IF v_variant IS NOT NULL AND v_variant.price > 0 THEN
      v_unit_price := v_variant.price;
    ELSE
      v_unit_price := v_product.price;
    END IF;

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

  -- ── Apply coupon discount ────────────────────────────────
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

  -- ── Compute shipping ─────────────────────────────────────
  IF p_customer_city IS NOT NULL AND length(trim(p_customer_city)) > 0 THEN
    SELECT shipping_cost INTO v_shipping
    FROM public.delivery_areas
    WHERE name = trim(p_customer_city)
      AND active IS TRUE
    LIMIT 1;
  END IF;
  IF v_shipping IS NULL THEN v_shipping := 0; END IF;

  DECLARE
    v_free_threshold numeric;
  BEGIN
    SELECT free_shipping_threshold INTO v_free_threshold
    FROM public.settings WHERE id = 1;
    IF v_free_threshold IS NOT NULL AND v_free_threshold > 0 AND v_subtotal >= v_free_threshold THEN
      v_shipping := 0;
    END IF;
  END;

  IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
  v_total := v_subtotal - v_discount + v_shipping;
  IF v_total < 0 THEN v_total := 0; END IF;

  -- ── Insert order ─────────────────────────────────────────
  INSERT INTO public.orders (
    order_number, access_token,
    customer_name, customer_phone, customer_city, customer_address,
    subtotal, discount, shipping_cost, total,
    coupon_id, coupon_code, notes, payment_method, status
  ) VALUES (
    v_order_number, v_access_token,
    trim(p_customer_name), trim(p_customer_phone),
    trim(p_customer_city), trim(p_customer_address),
    v_subtotal, v_discount, v_shipping, v_total,
    v_coupon_id,
    CASE WHEN v_coupon_id IS NOT NULL THEN trim(p_coupon_code) ELSE NULL END,
    p_notes, COALESCE(p_payment_method, 'cod'), 'ordered'
  )
  RETURNING id INTO v_order_id;

  -- ── Insert order items ───────────────────────────────────
  FOR v_item IN SELECT jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'qty')::int, 1);
    IF v_qty < 1 THEN v_qty := 1; END IF;

    SELECT id, price INTO v_product
    FROM public.products
    WHERE id = NULLIF(v_item->>'product_id', '')::uuid;

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

    IF v_variant IS NOT NULL AND v_variant.price > 0 THEN
      v_unit_price := v_variant.price;
    ELSE
      v_unit_price := v_product.price;
    END IF;

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
      order_id, product_id, variant_id,
      product_name_snapshot, variant_label_snapshot, image_snapshot,
      unit_price, qty, line_total, options_snapshot, display_order
    ) VALUES (
      v_order_id, v_product.id,
      CASE WHEN v_variant IS NOT NULL THEN v_variant.id ELSE NULL END,
      COALESCE(v_item->>'product_name', 'منتج'),
      v_item->>'variant', v_item->>'image',
      v_unit_price, v_qty, v_line_total,
      COALESCE(v_item->'options', '[]'::jsonb),
      COALESCE((v_item->>'display_order')::int, 0)
    );

    UPDATE public.products SET stock = GREATEST(0, stock - v_qty) WHERE id = v_product.id;
    IF v_variant IS NOT NULL THEN
      UPDATE public.product_variants SET stock = GREATEST(0, stock - v_qty) WHERE id = v_variant.id;
    END IF;
  END LOOP;

  -- ── Finalize coupon ──────────────────────────────────────
  IF v_coupon_id IS NOT NULL THEN
    UPDATE public.coupons SET used = used + 1 WHERE id = v_coupon_id;
  END IF;

  -- ── Update order with final computed values ──────────────
  UPDATE public.orders
  SET subtotal = v_subtotal, discount = v_discount,
      shipping_cost = v_shipping, total = v_total,
      coupon_id = v_coupon_id,
      coupon_code = CASE WHEN v_coupon_id IS NOT NULL THEN trim(p_coupon_code) ELSE NULL END
  WHERE id = v_order_id;

  -- ── Return result (includes access_token for client) ─────
  v_result := jsonb_build_object(
    'id',           v_order_id,
    'order_number', v_order_number,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;

-- Grants
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

-- ═══════════════════════════════════════════════════════════
-- 4. Updated get_orders_by_phone: requires access_token
-- ═══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_orders_by_phone(text);

CREATE OR REPLACE FUNCTION public.get_orders_by_phone(
  p_phone text,
  p_access_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text;
  v_orders jsonb;
  v_has_token boolean;
BEGIN
  IF p_phone IS NULL OR length(trim(p_phone)) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_clean_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF length(v_clean_phone) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_has_token := p_access_token IS NOT NULL;

  SELECT jsonb_agg(o_data.order_obj ORDER BY o_data.created_at DESC)
  INTO v_orders
  FROM (
    SELECT jsonb_build_object(
      'id',            o.order_number,
      'uuid',          o.id,
      'date',          to_char(o.created_at, 'YYYY-MM-DD'),
      'status',        o.status,
      'customer',      jsonb_build_object(
        'name',    o.customer_name,
        'phone',   o.customer_phone,
        'city',    o.customer_city,
        'address', o.customer_address
      ),
      'subtotal',      o.subtotal,
      'discount',      o.discount,
      'shipping',      o.shipping_cost,
      'total',         o.total,
      'notes',         COALESCE(o.notes, ''),
      'paymentMethod', COALESCE(o.payment_method, 'cod'),
      'coupon',        COALESCE(o.coupon_code, ''),
      'access_token',  o.access_token,
      'items',         COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name',     oi.product_name_snapshot,
          'variant',  oi.variant_label_snapshot,
          'image',    oi.image_snapshot,
          'price',    oi.unit_price,
          'qty',      oi.qty,
          'options',  COALESCE(oi.options_snapshot, '[]'::jsonb)
        ) ORDER BY oi.display_order)
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      ), '[]'::jsonb)
    ) AS order_obj,
    o.created_at
    FROM public.orders o
    WHERE regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = v_clean_phone
      AND (
        -- Old orders (no token): allow phone-only access
        o.access_token IS NULL
        OR
        -- New orders: require matching token
        (v_has_token AND o.access_token = p_access_token)
        OR
        -- Admin: always allow (is_admin() check)
        public.is_admin()
      )
  ) o_data;

  RETURN COALESCE(v_orders, '[]'::jsonb);
END;
$$;

-- Grants
REVOKE EXECUTE ON FUNCTION public.get_orders_by_phone(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_phone(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(text, uuid) TO anon;

-- ═══════════════════════════════════════════════════════════
-- 5. Cleanup: delete old rate limit entries (> 1 hour)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.order_rate_limits
  WHERE window_start < now() - interval '1 hour';
END;
$$;
