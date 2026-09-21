-- Migration 012: Secure order tracking function
-- Allows anonymous users to track their order by order_number + customer_phone.
-- Returns only safe fields (no personal data). Does NOT change RLS or schema.

DROP FUNCTION IF EXISTS public.track_order(text, text);

CREATE OR REPLACE FUNCTION public.track_order(
  p_order_number text,
  p_customer_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_items jsonb;
  v_result jsonb;
BEGIN
  SELECT
    o.order_number,
    o.status,
    o.created_at,
    o.subtotal,
    o.shipping_cost,
    o.total,
    o.payment_method,
    o.delivery_area_name,
    o.notes
  INTO v_order
  FROM public.orders o
  WHERE o.order_number = p_order_number
    AND o.customer_phone = p_customer_phone
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name_snapshot', oi.product_name_snapshot,
    'variant_label_snapshot', oi.variant_label_snapshot,
    'image_snapshot', oi.image_snapshot,
    'unit_price', oi.unit_price,
    'qty', oi.qty,
    'line_total', oi.line_total,
    'options_snapshot', oi.options_snapshot
  ) ORDER BY oi.display_order)
  INTO v_items
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.order_number = p_order_number
    AND o.customer_phone = p_customer_phone;

  v_result := jsonb_build_object(
    'found', true,
    'order', jsonb_build_object(
      'order_number', v_order.order_number,
      'status', v_order.status,
      'created_at', v_order.created_at,
      'subtotal', v_order.subtotal,
      'shipping_cost', v_order.shipping_cost,
      'total', v_order.total,
      'payment_method', v_order.payment_method,
      'delivery_area_name', v_order.delivery_area_name,
      'notes', v_order.notes
    ),
    'items', COALESCE(v_items, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.track_order(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.track_order(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.track_order(text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.track_order(text, text) TO anon;
