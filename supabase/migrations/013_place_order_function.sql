-- Migration 013: place_order RPC
--
-- Creates an order + order_items atomically from the storefront.
-- SECURITY DEFINER bypasses RLS so anon callers can place orders.
-- SET search_path = '' prevents search-path injection.
-- All table references are schema-qualified (public.*).
--
-- The function NEVER accepts: status, created_at, updated_at,
-- customer_extra, coupon_id, delivery_area_id, delivery_area_name.
-- status is always 'ordered'.

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
  v_item          jsonb;
  v_line_total    numeric;
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

  -- ── Resolve coupon_id (optional) ─────────────────────────
  v_coupon_id := NULL;
  IF p_coupon_code IS NOT NULL AND length(trim(p_coupon_code)) > 0 THEN
    SELECT c.id INTO v_coupon_id
    FROM public.coupons c
    WHERE c.code = trim(p_coupon_code)
    LIMIT 1;
  END IF;

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
    COALESCE(p_subtotal, 0),
    COALESCE(p_discount, 0),
    COALESCE(p_shipping_cost, 0),
    COALESCE(p_total, 0),
    v_coupon_id,
    CASE WHEN p_coupon_code IS NOT NULL AND length(trim(p_coupon_code)) > 0
         THEN trim(p_coupon_code) ELSE NULL END,
    p_notes,
    COALESCE(p_payment_method, 'cod'),
    'ordered'
  )
  RETURNING id INTO v_order_id;

  -- ── Insert order items ───────────────────────────────────
  FOR v_item IN SELECT jsonb_array_elements(p_items)
  LOOP
    v_line_total := (COALESCE((v_item->>'qty')::int, 1))
                  * (COALESCE((v_item->>'price')::numeric, 0));

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
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      COALESCE(v_item->>'product_name', 'منتج'),
      v_item->>'variant',
      v_item->>'image',
      COALESCE((v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'qty')::int, 1),
      v_line_total,
      COALESCE(v_item->'options', '[]'::jsonb),
      COALESCE((v_item->>'display_order')::int, 0)
    );
  END LOOP;

  -- ── Return result ────────────────────────────────────────
  v_result := jsonb_build_object(
    'id',           v_order_id,
    'order_number', v_order_number
  );

  RETURN v_result;
END;
$$;

-- ── Grants ────────────────────────────────────────────────
-- Revoke from everyone first, then grant only to anon (storefront).
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
