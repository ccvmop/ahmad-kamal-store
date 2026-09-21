-- Migration 016: get_orders_by_phone RPC
--
-- Allows anonymous storefront users to fetch their own orders by phone.
-- SECURITY DEFINER bypasses RLS so anon callers can read their orders.
-- Phone is validated server-side: only exact match on customer_phone is returned.
-- No changes to RLS policies, grants, or existing functions.

DROP FUNCTION IF EXISTS public.get_orders_by_phone(text);

CREATE OR REPLACE FUNCTION public.get_orders_by_phone(
  p_phone text
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
BEGIN
  -- ── Validate input ─────────────────────────────────────
  IF p_phone IS NULL OR length(trim(p_phone)) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Normalize: strip all non-digit characters
  v_clean_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');

  IF length(v_clean_phone) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- ── Fetch orders with items ────────────────────────────
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
  ) o_data;

  RETURN COALESCE(v_orders, '[]'::jsonb);
END;
$$;

-- ── Grants ────────────────────────────────────────────────
-- Revoke from everyone first, then grant only to anon (storefront).
REVOKE EXECUTE ON FUNCTION public.get_orders_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_phone(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(text) TO anon;
