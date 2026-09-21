-- ================================================================
-- MIGRATION 009: Replace seed catalog with real store data
-- ================================================================
-- This migration is IDEMPOTENT and safely rerunnable.
--
-- ROOT CAUSE: Previous DELETEs failed silently because the SQL
-- Editor has no JWT session — auth.uid() returns NULL — so the
-- is_admin() RLS function returns false, blocking all writes.
--
-- FIX: Wrap destructive operations in a DO block that temporarily
-- disables RLS (the postgres table-owner always has this privilege),
-- performs the deletes, then re-enables RLS. An EXCEPTION handler
-- guarantees RLS is restored even on failure.
--
-- Seed records identified by legacy_id pattern:
--   Products:  p1..p12       (12 rows)
--   Variants:  v1..v26       (26 rows)
--   Categories: c1..c6, c1-1, c1-2, c2-1, c2-2 (10 rows)
--
-- Your custom records (different legacy_id patterns, NEVER deleted):
--   Products:  p_mthhur44jfvca, p_mtk1ccqv7tq6z
--   Variants:  v_1788196230413eolj .. v_1788349722464fp5w
--   Category:  c_mtcxppzbuqji1
-- ================================================================


-- =========================================================
-- STEP 1–3: Delete ALL seed data (RLS temporarily disabled)
-- =========================================================
-- Delete order respects FK: variants -> products -> categories.
-- All ON DELETE SET NULL on order_items preserves historical orders.

DO $$
BEGIN
  -- Disable RLS on catalog tables (postgres owner always has this privilege).
  ALTER TABLE public.product_variants DISABLE ROW LEVEL SECURITY;
  ALTER TABLE public.products           DISABLE ROW LEVEL SECURITY;
  ALTER TABLE public.categories         DISABLE ROW LEVEL SECURITY;

  -- STEP 1: Delete seed variants (26 rows, v1..v26)
  DELETE FROM public.product_variants
    WHERE legacy_id IN (
      'v1','v2','v3','v4',
      'v5','v6','v7','v8',
      'v9','v10','v11','v12','v13',
      'v14','v15',
      'v16','v17','v18','v19',
      'v20','v21','v22','v23',
      'v24','v25','v26'
    );

  -- STEP 2: Delete seed products (12 rows, p1..p12)
  DELETE FROM public.products
    WHERE legacy_id IN (
      'p1','p2','p3','p4','p5','p6',
      'p7','p8','p9','p10','p11','p12'
    );

  -- STEP 3: Delete seed categories (10 rows)
  -- Includes both parent categories (c1-c6) and subcategories.
  DELETE FROM public.categories
    WHERE legacy_id IN (
      'c1','c2','c3','c4','c5','c6',
      'c1-1','c1-2','c2-1','c2-2'
    );

  -- Re-enable RLS on all three tables.
  ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.categories         ENABLE ROW LEVEL SECURITY;

  RAISE NOTICE 'Migration 009: Seed data deleted. RLS re-enabled.';
EXCEPTION WHEN OTHERS THEN
  -- Always re-enable RLS even if something fails.
  BEGIN
    ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.categories         ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RAISE;
END $$;


-- =========================================================
-- STEP 4: Insert your 7 custom categories (UPSERT)
-- =========================================================
-- These are safe: ON CONFLICT DO UPDATE means rerunning is idempotent.
-- If a category with the same legacy_id exists, its name/icon/order
-- is updated. If it does not exist, it is inserted.

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c1', 'خرز', '📦', NULL, 1, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c2', 'شمع', '📦', NULL, 2, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c3', 'معادن', '📦', NULL, 3, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c4', 'شبر', '📦', NULL, 4, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c5', 'خرز', '📦', NULL, 5, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c6', 'اكسسوارات شناتي', '👜', NULL, 6, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;

INSERT INTO public.categories (legacy_id, name, icon, parent_id, display_order, image_url, active)
VALUES ('c_mtcxppzbuqji1', 'خيوط', '📦', NULL, 11, NULL, true)
ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, display_order = EXCLUDED.display_order;


-- =========================================================
-- STEP 5: Insert your 2 custom products (UPSERT)
-- =========================================================
-- Both belong to category c_mtcxppzbuqji1 (خيوط).
-- Product-level price/stock = 0 (real pricing is on variants).
-- ON CONFLICT: update name + category_id if already exists.

INSERT INTO public.products (
  legacy_id, sku, name, short_description, description,
  category_id, price, old_price, stock, images,
  featured, is_new, on_sale, most_sold, active,
  rating, reviews, display_order, extra
) VALUES (
  'p_mthhur44jfvca', '', 'خيط مصيص', '', '',
  (SELECT id FROM public.categories WHERE legacy_id = 'c_mtcxppzbuqji1'),
  0, 0, 0, '{}'::text[],
  false, false, false, false, true,
  0, 0, 0, '{}'::jsonb
)
ON CONFLICT (legacy_id) DO UPDATE SET
  name = EXCLUDED.name,
  category_id = EXCLUDED.category_id;

INSERT INTO public.products (
  legacy_id, sku, name, short_description, description,
  category_id, price, old_price, stock, images,
  featured, is_new, on_sale, most_sold, active,
  rating, reviews, display_order, extra
) VALUES (
  'p_mtk1ccqv7tq6z', '', 'عيدان مخمل', '', '',
  (SELECT id FROM public.categories WHERE legacy_id = 'c_mtcxppzbuqji1'),
  0, 0, 0, '{}'::text[],
  false, false, false, false, true,
  0, 0, 0, '{}'::jsonb
)
ON CONFLICT (legacy_id) DO UPDATE SET
  name = EXCLUDED.name,
  category_id = EXCLUDED.category_id;


-- =========================================================
-- STEP 6: Insert your 9 custom variants (UPSERT)
-- =========================================================
-- product_id resolved via subquery on legacy_id.
-- ON CONFLICT: update all fields if variant already exists.

-- خيط مصيص — 3 variants

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788196230413eolj',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mthhur44jfvca'),
  'size', '0.5', NULL, 3.00, 99, NULL, true, 0
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_17881962614139vgi',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mthhur44jfvca'),
  'color', 'احمر', '#f70202', 3.00, 99, NULL, true, 1
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788196299331dw87',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mthhur44jfvca'),
  'color', 'اسود', NULL, 3.00, 100, NULL, true, 2
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;


-- عيدان مخمل — 6 variants

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788349456259c55c',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mtk1ccqv7tq6z'),
  'color', 'احمر', '#f40b0b', 0.80, 979, NULL, true, 0
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_17883495181976y1o',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mtk1ccqv7tq6z'),
  'color', 'ازرق', '#1f0fff', 0.80, 999, NULL, true, 1
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788349629752eul3',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mtk1ccqv7tq6z'),
  'color', 'اصفر', '#edfb2d', 0.80, 1000, NULL, true, 2
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788349665623gtq9',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mtk1ccqv7tq6z'),
  'color', 'اسود', NULL, 0.00, 1000, NULL, true, 3
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788349703584323j',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mtk1ccqv7tq6z'),
  'color', 'نيلي', '#0d066f', 0.00, 1000, NULL, true, 4
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;

INSERT INTO public.product_variants (
  legacy_id, product_id, legacy_type, legacy_value, legacy_swatch,
  price, stock, image_url, active, display_order
) VALUES (
  'v_1788349722464fp5w',
  (SELECT id FROM public.products WHERE legacy_id = 'p_mtk1ccqv7tq6z'),
  'color', 'ابيض', '#ffffff', 0.00, 1000, NULL, true, 5
) ON CONFLICT (legacy_id) DO UPDATE SET
  product_id = EXCLUDED.product_id, legacy_type = EXCLUDED.legacy_type,
  legacy_value = EXCLUDED.legacy_value, legacy_swatch = EXCLUDED.legacy_swatch,
  price = EXCLUDED.price, stock = EXCLUDED.stock;
