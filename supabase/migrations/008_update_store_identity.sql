-- Migration 008: Update store identity to match Ahmad Kamal Store
-- Run this AFTER migration 007

UPDATE public.settings SET
  store_name       = 'معرض أحمد كمال',
  store_name_en    = 'Ahmad Kamal Store',
  contact_email    = 'Ahmadkamalstore@gmail.com',
  contact_phone    = '+962782508869',
  whatsapp         = '962782508869',
  facebook         = '',
  instagram        = '',
  twitter          = '',
  tiktok           = '',
  snapchat         = '',
  youtube          = '',
  tagline          = 'أناقة بلا حدود',
  footer           = jsonb_set(
    COALESCE(footer, '{}'::jsonb),
    '{aboutText}',
    '"معرض أحمد كمال وجهتك المثالية للأزياء العصرية والأنيقة. نقدم لك تشكيلة واسعة من الملابس والإكسسوارات بأعلى جودة وأفضل الأسعار مع خدمة توصيل سريعة لجميع محافظات المملكة الأردنية الهاشمية."'
  )
WHERE id = 1;
