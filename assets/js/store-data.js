/* =========================================================
   Ahmad Kamal Store - Data Store Layer
   Simulates a real backend with localStorage persistence.
   Clean architecture ready to be swapped with a real API.
   ========================================================= */

const DB_KEY = 'anwar_store_v2';
const SESSION_KEY = 'anwar_session_v1';
const CART_KEY = 'anwar_cart_v1';
const WISHLIST_KEY = 'anwar_wishlist_v1';
const ORDERS_SEEN_KEY = 'anwar_orders_seen_at';
const ADMIN_CREDS_KEY = 'anwar_admin_creds';

function simpleHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

/* ---------- Default seed data ---------- */
const DEFAULT_DATA = {
  settings: {
    storeName: 'معرض أحمد كمال',
    storeNameEn: 'Ahmad Kamal Store',
    tagline: 'أناقة بلا حدود',
    logo: '',
    primaryColor: '#14b8a6',
    accentColor: '#1a1a1a',
    contactEmail: 'Ahmadkamalstore@gmail.com',
    contactPhone: '+962782508869',
    whatsapp: '962782508869',
    address: 'عمّان، المملكة الأردنية الهاشمية',
    currency: 'د.أ',
    currencyCode: 'JOD',
    facebook: '',
    instagram: '',
    twitter: '',
    tiktok: '',
    snapchat: '',
    youtube: '',
    heroSlides: [
      { id: 's1', title: 'مجموعة الموسم الجديدة', subtitle: 'اكتشف أحدث صيحات الموضة العالمية بأسعار لا تُقاوم', cta: 'تسوق الآن', link: '#shop', image: '', active: true, order: 1 },
      { id: 's2', title: 'خصومات تصل إلى 50%', subtitle: 'عروض حصرية على تشكيلة مختارة من المنتجات الفاخرة', cta: 'استكشف العروض', link: '#shop', image: '', active: true, order: 2 },
      { id: 's3', title: 'توصيل سريع لجميع المحافظات', subtitle: 'اطلب الآن واحصل على طلبك خلال 24-48 ساعة في جميع أنحاء الأردن', cta: 'تسوق حسب الفئة', link: '#shop', image: '', active: true, order: 3 }
    ],
    announcement: {
      enabled: true,
      image: '',
      title: 'شحن مجاني للطلبات فوق 50 دينار',
      text: 'استفد من عرض الشحن المجاني على جميع الطلبات فوق 50 دينار أردني في جميع محافظات المملكة',
      cta: 'تسوق الآن',
      link: '#shop',
      bgColor: '#14b8a6'
    },
    homepageSections: {
      featured: { enabled: true, title: 'منتجات مميزة', subtitle: 'مختارة خصيصاً لك', productIds: [] },
      newArrivals: { enabled: true, title: 'وصل حديثًا', subtitle: 'أحدث المنتجات في متجرنا', productIds: [] },
      onSale: { enabled: true, title: 'عروض وتخفيضات', subtitle: 'وفر أكثر مع تخفيضاتنا الحصرية', productIds: [] }
    },
    navigation: [
      { id: 'n1', label: 'الرئيسية', type: 'route', value: 'home', order: 1, active: true },
      { id: 'n2', label: 'العروض', type: 'route', value: 'offers', order: 2, active: true },
      { id: 'n3', label: 'وصل حديثًا', type: 'route', value: 'new', order: 3, active: true },
      { id: 'n4', label: 'جميع المنتجات', type: 'route', value: 'shop', order: 4, active: true },
      { id: 'n5', label: 'طلباتي', type: 'route', value: 'myorders', order: 5, active: true }
    ],
    floatingWhatsapp: { enabled: true, message: 'مرحباً، أرغب بالاستفسار عن منتجاتكم' },
    freeShippingThreshold: 50,
    defaultShippingCost: 0,
    footer: {
      aboutText: 'معرض أحمد كمال وجهتك المثالية للأزياء العصرية والأنيقة. نقدم لك تشكيلة واسعة من الملابس والإكسسوارات بأعلى جودة وأفضل الأسعار مع خدمة توصيل سريعة لجميع محافظات المملكة الأردنية الهاشمية.',
      showSocial: true,
      showPhone: true,
      showWhatsapp: true,
      showAddress: true,
      copyright: ''
    },
    invoice: {
      normal: {
        headerText: '',
        footerText: 'شكراً لتعاملكم معنا',
        extraText: '',
        colors: { text: '#1a1a1a', heading: '#0d9488', border: '#e8e3d8', total: '#6b4423' }
      },
      thermal: {
        enabled: false,
        paperSize: '80mm',
        qrUrl: '',
        headerText: '',
        footerText: 'شكراً لزيارتكم',
        extraText: '',
        colors: { text: '#000000', heading: '#000000', border: '#000000', total: '#000000' }
      }
    }
  },
  categories: [
    { id: 'c1', name: 'ملابس رجالية', icon: '👔', parent: null, order: 1 },
    { id: 'c2', name: 'ملابس نسائية', icon: '👗', parent: null, order: 2 },
    { id: 'c3', name: 'أحذية', icon: '👟', parent: null, order: 3 },
    { id: 'c4', name: 'إكسسوارات', icon: '⌚', parent: null, order: 4 },
    { id: 'c5', name: 'عطور', icon: '🌸', parent: null, order: 5 },
    { id: 'c6', name: 'حقائب', icon: '👜', parent: null, order: 6 },
    { id: 'c1-1', name: 'قمصان', icon: '👕', parent: 'c1', order: 1 },
    { id: 'c1-2', name: 'بناطيل', icon: '👖', parent: 'c1', order: 2 },
    { id: 'c2-1', name: 'فساتين', icon: '👗', parent: 'c2', order: 1 },
    { id: 'c2-2', name: 'عبايات', icon: '🥻', parent: 'c2', order: 2 }
  ],
  products: [
    {
      id: 'p1', name: 'قميص كلاسيكي أزرق', sku: 'SH-001',
      categoryId: 'c1-1', price: 180, oldPrice: 250, stock: 24,
      images: ['https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600'],
      description: 'قميص رجالي كلاسيكي بقماش قطني عالي الجودة، مناسب للمناسبات الرسمية وغير الرسمية.',
      shortDescription: 'قميص قطني أنيق',
      featured: true, isNew: false, onSale: true, active: true,
      rating: 4.6, reviews: 32,
      variants: [
        { id: 'v1', type: 'size', value: 'S', price: 180, stock: 6 },
        { id: 'v2', type: 'size', value: 'M', price: 180, stock: 8 },
        { id: 'v3', type: 'size', value: 'L', price: 180, stock: 6 },
        { id: 'v4', type: 'size', value: 'XL', price: 180, stock: 4 }
      ],
      createdAt: '2026-01-12'
    },
    {
      id: 'p2', name: 'فستان سهرة أسود فاخر', sku: 'DR-002',
      categoryId: 'c2-1', price: 850, oldPrice: 1200, stock: 12,
      images: ['https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=600'],
      description: 'فستان سهرة أنيق بقصة حورية البحر، مزين بتطريز يدوي فاخر، مناسب للمناسبات الخاصة.',
      shortDescription: 'فستان فاخر للسهرات',
      featured: true, isNew: true, onSale: true, active: true,
      rating: 4.9, reviews: 58,
      variants: [
        { id: 'v5', type: 'size', value: 'S', price: 850, stock: 3 },
        { id: 'v6', type: 'size', value: 'M', price: 850, stock: 4 },
        { id: 'v7', type: 'size', value: 'L', price: 850, stock: 3 },
        { id: 'v8', type: 'color', value: 'أسود', swatch: '#000000', price: 850, stock: 2 }
      ],
      createdAt: '2026-02-04'
    },
    {
      id: 'p3', name: 'حذاء رياضي أبيض عصري', sku: 'SH-003',
      categoryId: 'c3', price: 420, oldPrice: 0, stock: 18,
      images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600'],
      description: 'حذاء رياضي عصري مريح للاستخدام اليومي، خفيف الوزن بتصميم مبتكر.',
      shortDescription: 'حذاء رياضي عصري',
      featured: true, isNew: true, onSale: false, active: true,
      rating: 4.7, reviews: 89,
      variants: [
        { id: 'v9', type: 'size', value: '40', price: 420, stock: 4 },
        { id: 'v10', type: 'size', value: '41', price: 420, stock: 5 },
        { id: 'v11', type: 'size', value: '42', price: 420, stock: 5 },
        { id: 'v12', type: 'size', value: '43', price: 420, stock: 4 },
        { id: 'v13', type: 'color', value: 'أبيض', swatch: '#ffffff', price: 420, stock: 0 }
      ],
      createdAt: '2026-03-10'
    },
    {
      id: 'p4', name: 'ساعة يد فاخرة ذهبية', sku: 'AC-004',
      categoryId: 'c4', price: 1500, oldPrice: 2200, stock: 6,
      images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600'],
      description: 'ساعة يد فاخرة بإطار ذهبي وسوار جلدي إيطالي، مقاومة للماء حتى 50 متر.',
      shortDescription: 'ساعة فاخرة بإطار ذهبي',
      featured: true, isNew: false, onSale: true, active: true,
      rating: 4.8, reviews: 41,
      variants: [],
      createdAt: '2026-01-22'
    },
    {
      id: 'p5', name: 'عطر شرقي مميز', sku: 'PR-005',
      categoryId: 'c5', price: 320, oldPrice: 0, stock: 30,
      images: ['https://images.unsplash.com/photo-1541643600914-78b084683601?w=600'],
      description: 'عطر شرقي فاخر بمزيج العود والورد والمسك، عبوة 100 مل.',
      shortDescription: 'عطر شرقي فاخر 100مل',
      featured: false, isNew: true, onSale: false, active: true,
      rating: 4.9, reviews: 67,
      variants: [],
      createdAt: '2026-03-25'
    },
    {
      id: 'p6', name: 'حقيبة يد جلدية بنية', sku: 'BG-006',
      categoryId: 'c6', price: 680, oldPrice: 950, stock: 9,
      images: ['https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600'],
      description: 'حقيبة يد نسائية من الجلد الطبيعي الإيطالي، تصميم عصري وأنيق.',
      shortDescription: 'حقيبة جلد طبيعي',
      featured: true, isNew: false, onSale: true, active: true,
      rating: 4.5, reviews: 23,
      variants: [
        { id: 'v14', type: 'color', value: 'بني', swatch: '#8B4513', price: 680, stock: 5 },
        { id: 'v15', type: 'color', value: 'أسود', swatch: '#000000', price: 680, stock: 4 }
      ],
      createdAt: '2026-02-15'
    },
    {
      id: 'p7', name: 'بنطلون جينز كلاسيكي', sku: 'PN-007',
      categoryId: 'c1-2', price: 220, oldPrice: 0, stock: 35,
      images: ['https://images.unsplash.com/photo-1542272604-787c3835535d?w=600'],
      description: 'بنطلون جينز كلاسيكي بقصة مستقيمة، خامة قطنية مرنة مريحة.',
      shortDescription: 'جينز كلاسيكي مريح',
      featured: false, isNew: false, onSale: false, active: true,
      rating: 4.4, reviews: 51,
      variants: [
        { id: 'v16', type: 'size', value: '30', price: 220, stock: 8 },
        { id: 'v17', type: 'size', value: '32', price: 220, stock: 10 },
        { id: 'v18', type: 'size', value: '34', price: 220, stock: 9 },
        { id: 'v19', type: 'size', value: '36', price: 220, stock: 8 }
      ],
      createdAt: '2026-01-05'
    },
    {
      id: 'p8', name: 'عباية سوداء مطرزة', sku: 'AB-008',
      categoryId: 'c2-2', price: 590, oldPrice: 0, stock: 16,
      images: ['https://images.unsplash.com/photo-1590548784585-643d2b9c2928?w=600'],
      description: 'عباية سوداء فاخرة بتطريز يدوي على الأكمام والأطراف، قماش كريب ممتاز.',
      shortDescription: 'عباية بتطريز يدوي',
      featured: true, isNew: true, onSale: false, active: true,
      rating: 4.8, reviews: 78,
      variants: [
        { id: 'v20', type: 'size', value: 'S', price: 590, stock: 4 },
        { id: 'v21', type: 'size', value: 'M', price: 590, stock: 4 },
        { id: 'v22', type: 'size', value: 'L', price: 590, stock: 4 },
        { id: 'v23', type: 'size', value: 'XL', price: 590, stock: 4 }
      ],
      createdAt: '2026-04-01'
    },
    {
      id: 'p9', name: 'نظارة شمسية أنيقة', sku: 'AC-009',
      categoryId: 'c4', price: 280, oldPrice: 400, stock: 22,
      images: ['https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600'],
      description: 'نظارة شمسية بإطار معدني وعدسات مستقطبة، حماية كاملة من الأشعة فوق البنفسجية.',
      shortDescription: 'نظارة بعدسات مستقطبة',
      featured: false, isNew: false, onSale: true, active: true,
      rating: 4.3, reviews: 18,
      variants: [],
      createdAt: '2026-02-20'
    },
    {
      id: 'p10', name: 'جاكيت جلد طبيعي', sku: 'JK-010',
      categoryId: 'c1', price: 1280, oldPrice: 0, stock: 8,
      images: ['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600'],
      description: 'جاكيت رجالي من الجلد الطبيعي الأصلي، تصميم عصري ببطانة داخلية.',
      shortDescription: 'جاكيت جلد طبيعي',
      featured: true, isNew: true, onSale: false, active: true,
      rating: 4.7, reviews: 29,
      variants: [
        { id: 'v24', type: 'size', value: 'M', price: 1280, stock: 2 },
        { id: 'v25', type: 'size', value: 'L', price: 1280, stock: 3 },
        { id: 'v26', type: 'size', value: 'XL', price: 1280, stock: 3 }
      ],
      createdAt: '2026-03-15'
    },
    {
      id: 'p11', name: 'بلوزة حرير أنيقة', sku: 'BL-011',
      categoryId: 'c2', price: 340, oldPrice: 0, stock: 18,
      images: ['https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=600'],
      description: 'بلوزة نسائية من الحرير الطبيعي، تصميم كلاسيكي مناسب للعمل والمناسبات.',
      shortDescription: 'بلوزة حرير طبيعي',
      featured: false, isNew: true, onSale: false, active: true,
      rating: 4.6, reviews: 35,
      variants: [],
      createdAt: '2026-04-10'
    },
    {
      id: 'p12', name: 'حذاء كاجوال جلد', sku: 'SH-012',
      categoryId: 'c3', price: 540, oldPrice: 750, stock: 14,
      images: ['https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=600'],
      description: 'حذاء كاجوال رجالي من الجلد الطبيعي، نعل مريح للاستخدام اليومي الطويل.',
      shortDescription: 'حذاء جلد طبيعي',
      featured: false, isNew: false, onSale: true, active: true,
      rating: 4.5, reviews: 44,
      variants: [],
      createdAt: '2026-02-28'
    }
  ],
  coupons: [
    { id: 'co1', code: 'WELCOME10', type: 'percent', value: 10, minOrder: 30, maxUses: 100, used: 12, expiresAt: '2026-12-31', active: true },
    { id: 'co2', code: 'SAVE5', type: 'fixed', value: 5, minOrder: 50, maxUses: 50, used: 8, expiresAt: '2026-09-30', active: true },
    { id: 'co3', code: 'FREESHIP', type: 'fixed', value: 3, minOrder: 0, maxUses: 999, used: 45, expiresAt: '2026-12-31', active: true }
  ],
  deliveryAreas: [
    { id: 'd1', name: 'عمّان', shippingCost: 2, active: true, order: 1 },
    { id: 'd2', name: 'إربد', shippingCost: 4, active: true, order: 2 },
    { id: 'd3', name: 'الزرقاء', shippingCost: 3, active: true, order: 3 },
    { id: 'd4', name: 'العقبة', shippingCost: 5, active: true, order: 4 },
    { id: 'd5', name: 'البلقاء', shippingCost: 3, active: true, order: 5 },
    { id: 'd6', name: 'المفرق', shippingCost: 5, active: true, order: 6 },
    { id: 'd7', name: 'جرش', shippingCost: 4, active: true, order: 7 },
    { id: 'd8', name: 'عجلون', shippingCost: 4, active: true, order: 8 },
    { id: 'd9', name: 'الكرك', shippingCost: 5, active: true, order: 9 },
    { id: 'd10', name: 'معان', shippingCost: 6, active: true, order: 10 },
    { id: 'd11', name: 'الطفيلة', shippingCost: 6, active: true, order: 11 },
    { id: 'd12', name: 'مادبا', shippingCost: 3, active: true, order: 12 }
  ],
  offers: [],
  orders: [
    { id: 'ORD-2026-1001', date: '2026-08-20', customer: { name: 'أحمد محمد', phone: '0791234567', city: 'عمّان', address: 'الدوار السابع، شارع المدينة المنورة' }, items: [{ productId: 'p1', name: 'قميص كلاسيكي أزرق', variant: 'M', qty: 1, price: 180, image: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600' }, { productId: 'p3', name: 'حذاء رياضي أبيض عصري', variant: '42', qty: 1, price: 420, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600' }], subtotal: 600, discount: 0, shipping: 2, total: 602, status: 'delivered', paymentMethod: 'cod', notes: '' },
    { id: 'ORD-2026-1002', date: '2026-08-22', customer: { name: 'سارة العتيبي', phone: '0789876543', city: 'إربد', address: 'حي الروضة، شارع الجامعة' }, items: [{ productId: 'p2', name: 'فستان سهرة أسود فاخر', variant: 'M', qty: 1, price: 850, image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=600' }], subtotal: 850, discount: 85, shipping: 0, total: 765, status: 'out_for_delivery', paymentMethod: 'cod', notes: 'الرجاء الاتصال قبل الوصول', coupon: 'WELCOME10' },
    { id: 'ORD-2026-1003', date: '2026-08-24', customer: { name: 'خالد السالم', phone: '0773334444', city: 'الزرقاء', address: 'حي الفيصلية' }, items: [{ productId: 'p4', name: 'ساعة يد فاخرة ذهبية', qty: 1, price: 1500, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600' }], subtotal: 1500, discount: 0, shipping: 0, total: 1500, status: 'preparing', paymentMethod: 'cod', notes: '' },
    { id: 'ORD-2026-1004', date: '2026-08-25', customer: { name: 'نورة الشمري', phone: '0796677889', city: 'عمّان', address: 'حي النخيل، شارع مكة' }, items: [{ productId: 'p8', name: 'عباية سوداء مطرزة', variant: 'L', qty: 1, price: 590, image: 'https://images.unsplash.com/photo-1590548784585-643d2b9c2928?w=600' }, { productId: 'p5', name: 'عطر شرقي مميز', qty: 2, price: 320, image: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=600' }], subtotal: 1230, discount: 0, shipping: 0, total: 1230, status: 'received', paymentMethod: 'cod', notes: '' },
    { id: 'ORD-2026-1005', date: '2026-08-26', customer: { name: 'فهد القحطاني', phone: '0781122334', city: 'العقبة', address: 'العقبة الجديدة، شارع الحمى' }, items: [{ productId: 'p10', name: 'جاكيت جلد طبيعي', variant: 'L', qty: 1, price: 1280, image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600' }], subtotal: 1280, discount: 50, shipping: 0, total: 1230, status: 'preparing', paymentMethod: 'cod', notes: '', coupon: 'SAVE5' },
    { id: 'ORD-2026-1006', date: '2026-08-27', customer: { name: 'ريم الحربي', phone: '0779998877', city: 'البلقاء', address: 'السلط، حي العنبرية' }, items: [{ productId: 'p6', name: 'حقيبة يد جلدية بنية', variant: 'بني', qty: 1, price: 680, image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600' }, { productId: 'p9', name: 'نظارة شمسية أنيقة', qty: 1, price: 280, image: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600' }], subtotal: 960, discount: 0, shipping: 3, total: 963, status: 'ordered', paymentMethod: 'cod', notes: '' },
    { id: 'ORD-2026-1007', date: '2026-08-28', customer: { name: 'عبدالعزيز الغامدي', phone: '0797789900', city: 'الكرك', address: 'الكرك، شارع المستشفى' }, items: [{ productId: 'p7', name: 'بنطلون جينز كلاسيكي', variant: '32', qty: 2, price: 220, image: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600' }], subtotal: 440, discount: 0, shipping: 5, total: 445, status: 'cancelled', paymentMethod: 'cod', notes: 'ألغى العميل' }
  ]
};

/* ---------- Storage helpers ---------- */
let dbCache = null;

function loadDB() {
  if (dbCache) return dbCache;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) { dbCache = JSON.parse(JSON.stringify(DEFAULT_DATA)); ['products','categories','orders','coupons','deliveryAreas','offers'].forEach(function(k){ dbCache[k] = []; }); localStorage.setItem(DB_KEY, JSON.stringify(dbCache)); return dbCache; }
    dbCache = JSON.parse(raw);
    return dbCache;
  } catch (e) {
    dbCache = JSON.parse(JSON.stringify(DEFAULT_DATA));
    return dbCache;
  }
}

function saveDB(data) {
  dbCache = data;
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}
function clearDBCache() { dbCache = null; }
function uid(prefix='id') { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- Public API ---------- */
const Store = {
  /* Internal DB access (for Supabase sync functions) */
  _loadDB: loadDB,
  _saveDB: saveDB,
  _clearDBCache: clearDBCache,

  /* Settings */
  getSettings() { return loadDB().settings; },
  updateSettings(patch) { const db = loadDB(); db.settings = { ...db.settings, ...patch }; saveDB(db); return db.settings; },

  /* Categories */
  getCategories() { return loadDB().categories; },
  getCategory(id) { return loadDB().categories.find(c => c.id === id); },
  addCategory(cat) { const db = loadDB(); const id = uid('c'); db.categories.push({ ...cat, id, order: db.categories.length + 1 }); saveDB(db); return id; },
  updateCategory(id, patch) { const db = loadDB(); const i = db.categories.findIndex(c => c.id === id); if (i >= 0) { db.categories[i] = { ...db.categories[i], ...patch }; saveDB(db); } },
  deleteCategory(id) { const db = loadDB(); db.categories = db.categories.filter(c => c.id !== id); db.products.forEach(p => { if (p.categoryId === id) p.categoryId = null; }); saveDB(db); },
  updateCategories(list) { const db = loadDB(); db.categories = list; saveDB(db); },

  /* Products */
  getProducts(filter = {}) {
    let list = loadDB().products.filter(p => filter.active === undefined ? true : p.active);
    if (filter.featured) list = list.filter(p => p.featured);
    if (filter.isNew) list = list.filter(p => p.isNew);
    if (filter.onSale) list = list.filter(p => p.onSale && p.oldPrice > p.price);
    if (filter.categoryId) list = list.filter(p => p.categoryId === filter.categoryId);
    if (filter.search) { const q = filter.search.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)); }
    if (filter.minPrice != null) list = list.filter(p => p.price >= filter.minPrice);
    if (filter.maxPrice != null) list = list.filter(p => p.price <= filter.maxPrice);
    if (filter.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (filter.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else if (filter.sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (filter.sort === 'newest') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (filter.sort === 'popular') list.sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
    return list;
  },
  getProduct(id) { return loadDB().products.find(p => p.id === id); },
  addProduct(p) { const db = loadDB(); const id = uid('p'); const now = new Date().toISOString().slice(0, 10); db.products.push({ ...p, id, createdAt: now, rating: 0, reviews: 0 }); saveDB(db); return id; },
  updateProduct(id, patch) { const db = loadDB(); const i = db.products.findIndex(p => p.id === id); if (i >= 0) { db.products[i] = { ...db.products[i], ...patch }; saveDB(db); } },
  deleteProduct(id) { const db = loadDB(); db.products = db.products.filter(p => p.id !== id); saveDB(db); },
  updateProducts(list) { const db = loadDB(); db.products = list; saveDB(db); },

  /* Coupons */
  getCoupons() { return loadDB().coupons; },
  getCoupon(code) { return loadDB().coupons.find(c => c.code.toLowerCase() === code.toLowerCase() && c.active); },
  addCoupon(c) { const db = loadDB(); const id = uid('co'); db.coupons.push({ ...c, id, used: 0 }); saveDB(db); return id; },
  updateCoupon(id, patch) { const db = loadDB(); const i = db.coupons.findIndex(c => c.id === id); if (i >= 0) { db.coupons[i] = { ...db.coupons[i], ...patch }; saveDB(db); } },
  deleteCoupon(id) { const db = loadDB(); db.coupons = db.coupons.filter(c => c.id !== id); saveDB(db); },
  applyCoupon(code, subtotal) {
    const coupon = this.getCoupon(code);
    if (!coupon) return { ok: false, error: 'كود الخصم غير موجود أو معطل' };
    if (new Date(coupon.expiresAt) < new Date()) return { ok: false, error: 'انتهت صلاحية الكود' };
    if (coupon.maxUses > 0 && coupon.used >= coupon.maxUses) return { ok: false, error: 'تم استخدام الكود الحد الأقصى' };
    if (subtotal < coupon.minOrder) return { ok: false, error: 'الحد الأدنى للطلب ' + coupon.minOrder };
    let discount = coupon.type === 'percent' ? subtotal * coupon.value / 100 : coupon.value;
    return { ok: true, coupon, discount };
  },
  incrementCouponUsage(code) { const db = loadDB(); const c = db.coupons.find(x => x.code === code); if (c) { c.used++; saveDB(db); } },

  /* Orders */
  getOrders() { return loadDB().orders.sort((a, b) => new Date(b.date) - new Date(a.date)); },
  getOrder(id) { return loadDB().orders.find(o => o.id === id); },
  getOrdersByPhone(phone) { return loadDB().orders.filter(o => o.customer.phone === phone).sort((a, b) => new Date(b.date) - new Date(a.date)); },
  addOrder(order) {
    const db = loadDB();
    const year = new Date().getFullYear();
    const sameYearCount = db.orders.filter(o => (o.id || '').startsWith('AK_' + year + '_')).length;
    const seq = sameYearCount + 1;
    const id = 'AK_' + year + '_' + seq;
    const newOrder = { ...order, id, date: new Date().toISOString().slice(0, 10), notifiedAt: Date.now() };
    db.orders.push(newOrder);
    newOrder.items.forEach(item => {
      const p = db.products.find(x => x.id === item.productId);
      if (p) {
        p.stock = Math.max(0, p.stock - item.qty);
        const variantIdsToDecrement = new Set();
        if (item.options && item.options.length) {
          item.options.forEach(o => { if (o.variantId) variantIdsToDecrement.add(o.variantId); });
        }
        if (item.variantId) variantIdsToDecrement.add(item.variantId);
        if (item.colorId) variantIdsToDecrement.add(item.colorId);
        variantIdsToDecrement.forEach(vid => {
          const v = p.variants.find(vv => vv.id === vid);
          if (v) v.stock = Math.max(0, v.stock - item.qty);
        });
      }
    });
    if (order.coupon) this.incrementCouponUsage(order.coupon);
    saveDB(db);
    return newOrder;
  },
  updateOrderStatus(id, status) { const db = loadDB(); const o = db.orders.find(x => x.id === id); if (o) { o.status = status; saveDB(db); } },
  deleteOrder(id) { const db = loadDB(); db.orders = db.orders.filter(o => o.id !== id); saveDB(db); },

  /* Delivery Areas */
  getDeliveryAreas() { return (loadDB().deliveryAreas || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)); },
  getDeliveryArea(id) { return (loadDB().deliveryAreas || []).find(a => a.id === id); },
  getDeliveryAreaByName(name) { return (loadDB().deliveryAreas || []).find(a => a.name === name); },
  addDeliveryArea(area) { const db = loadDB(); if (!db.deliveryAreas) db.deliveryAreas = []; const id = uid('d'); db.deliveryAreas.push({ ...area, id, order: db.deliveryAreas.length + 1 }); saveDB(db); return id; },
  updateDeliveryArea(id, patch) { const db = loadDB(); const i = (db.deliveryAreas || []).findIndex(a => a.id === id); if (i >= 0) { db.deliveryAreas[i] = { ...db.deliveryAreas[i], ...patch }; saveDB(db); } },
  deleteDeliveryArea(id) { const db = loadDB(); db.deliveryAreas = (db.deliveryAreas || []).filter(a => a.id !== id); saveDB(db); },
  reorderDeliveryAreas(orderedIds) {
    const db = loadDB();
    if (!db.deliveryAreas) return;
    orderedIds.forEach((id, i) => { const a = db.deliveryAreas.find(x => x.id === id); if (a) a.order = i + 1; });
    saveDB(db);
  },

  /* Hero Slides */
  getHeroSlides() { return (loadDB().settings.heroSlides || []).filter(s => s.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0)); },
  addHeroSlide(slide) { const db = loadDB(); const id = uid('s'); db.settings.heroSlides.push({ ...slide, id, order: db.settings.heroSlides.length + 1, active: true }); saveDB(db); return id; },
  updateHeroSlide(id, patch) { const db = loadDB(); const i = db.settings.heroSlides.findIndex(s => s.id === id); if (i >= 0) { db.settings.heroSlides[i] = { ...db.settings.heroSlides[i], ...patch }; saveDB(db); } },
  deleteHeroSlide(id) { const db = loadDB(); db.settings.heroSlides = db.settings.heroSlides.filter(s => s.id !== id); saveDB(db); },
  reorderHeroSlides(orderedIds) {
    const db = loadDB();
    orderedIds.forEach((id, i) => { const s = db.settings.heroSlides.find(x => x.id === id); if (s) s.order = i + 1; });
    saveDB(db);
  },

  /* Homepage Sections */
  getHomepageSection(key) { return loadDB().settings.homepageSections?.[key]; },
  updateHomepageSection(key, patch) { const db = loadDB(); if (!db.settings.homepageSections) db.settings.homepageSections = {}; db.settings.homepageSections[key] = { ...db.settings.homepageSections[key], ...patch }; saveDB(db); return db.settings.homepageSections[key]; },

  /* Offers & Discounts */
  _offerStateAt(o, now) {
    now = now || Date.now();
    if (!o.startAt || !o.endAt) return 'scheduled';
    const start = new Date(o.startAt).getTime();
    const end = new Date(o.endAt).getTime();
    if (o.active === false) return 'disabled';
    if (now < start) return 'scheduled';
    if (now > end) return 'expired';
    return 'active';
  },
  getOffers() { return (loadDB().offers || []).slice(); },
  getOffer(id) { return (loadDB().offers || []).find(o => o.id === id); },
  addOffer(o) { const db = loadDB(); if (!db.offers) db.offers = []; const id = uid('of'); db.offers.push({ active: true, ...o, id }); saveDB(db); return id; },
  updateOffer(id, patch) { const db = loadDB(); const i = (db.offers || []).findIndex(o => o.id === id); if (i >= 0) { db.offers[i] = { ...db.offers[i], ...patch }; saveDB(db); } },
  deleteOffer(id) { const db = loadDB(); db.offers = (db.offers || []).filter(o => o.id !== id); saveDB(db); },
  getActiveOffersForProduct(product) {
    if (!product) return [];
    const now = Date.now();
    return (loadDB().offers || []).filter(o => {
      if (o.active === false) return false;
      if (!o.startAt || !o.endAt) return false;
      const start = new Date(o.startAt).getTime();
      const end = new Date(o.endAt).getTime();
      if (now < start || now > end) return false;
      if (o.targetType === 'product' && (o.targetId === product.id || o.targetId === product.uuid)) return true;
      if (o.targetType === 'category' && (o.targetId === product.categoryId || o.targetId === product.categoryUuid)) return true;
      return false;
    });
  },
  getBestOfferForProduct(product) {
    const offers = this.getActiveOffersForProduct(product);
    if (!offers.length) return null;
    return offers.reduce((best, o) => {
      const candidate = this.computeOfferPrice(product, o);
      if (!best || candidate.final < best.final) return candidate;
      return best;
    }, null);
  },
  computeOfferPrice(product, offer) {
    const original = Number(product.price) || 0;
    let final = original;
    if (offer.discountType === 'percent') {
      final = Math.max(0, original - (original * Number(offer.discountValue || 0) / 100));
    } else if (offer.discountType === 'fixed') {
      final = Math.max(0, Number(offer.discountValue || 0));
    }
    return { original, final, offer };
  },

  /* Navigation */
  getNavigation() {
    const nav = (loadDB().settings.navigation || []).filter(n => n.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    const hasTrack = nav.some(n => n.value === 'track');
    const hasMyOrders = nav.some(n => n.value === 'myorders');
    if (hasTrack && !hasMyOrders) {
      nav.forEach(n => { if (n.value === 'track') { n.value = 'myorders'; n.label = 'طلباتي'; } });
      const db = loadDB(); db.settings.navigation = nav; saveDB(db);
    } else if (hasTrack) {
      const db = loadDB(); db.settings.navigation = (db.settings.navigation || []).filter(n => n.value !== 'track'); saveDB(db);
      return (db.settings.navigation || []).filter(n => n.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return nav;
  },
  addNavItem(item) { const db = loadDB(); if (!db.settings.navigation) db.settings.navigation = []; const id = uid('n'); db.settings.navigation.push({ ...item, id, order: db.settings.navigation.length + 1, active: true }); saveDB(db); return id; },
  updateNavItem(id, patch) { const db = loadDB(); const i = (db.settings.navigation || []).findIndex(n => n.id === id); if (i >= 0) { db.settings.navigation[i] = { ...db.settings.navigation[i], ...patch }; saveDB(db); } },
  deleteNavItem(id) { const db = loadDB(); db.settings.navigation = (db.settings.navigation || []).filter(n => n.id !== id); saveDB(db); },
  reorderNav(orderedIds) {
    const db = loadDB();
    orderedIds.forEach((id, i) => { const n = db.settings.navigation.find(x => x.id === id); if (n) n.order = i + 1; });
    saveDB(db);
  },

  /* Stats */
  getStats() {
    const db = loadDB();
    const orders = db.orders;
    const validOrders = orders.filter(o => o.status !== 'cancelled');
    const totalRevenue = validOrders.reduce((s, o) => s + o.total, 0);
    const totalOrders = orders.length;
    const deliveredOrders = orders.filter(o => o.status === 'delivered').length;
    const cancelledOrders = orders.filter(o => o.status === 'cancelled').length;
    const totalProducts = db.products.length;
    const totalCustomers = new Set(orders.map(o => o.customer.phone)).size;
    const lowStockProducts = db.products.filter(p => p.stock < 5).length;
    // Profit = revenue - cost (cost is 60% of price as default estimate)
    const costRatio = 0.6;
    const totalCost = validOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + (i.price * costRatio * i.qty), 0), 0);
    const totalProfit = totalRevenue - totalCost;
    const bestSellers = {};
    validOrders.forEach(o => o.items.forEach(i => { bestSellers[i.productId] = (bestSellers[i.productId] || 0) + i.qty; }));
    const topProducts = Object.entries(bestSellers).map(([pid, qty]) => ({ product: db.products.find(p => p.id === pid), qty })).filter(x => x.product).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const salesByDay = {};
    const last30 = [...Array(30)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (29 - i)); return d.toISOString().slice(0, 10); });
    last30.forEach(d => salesByDay[d] = 0);
    validOrders.forEach(o => { if (salesByDay[o.date] !== undefined) salesByDay[o.date] += o.total; });
    const salesByCategory = {};
    validOrders.forEach(o => o.items.forEach(i => { const p = db.products.find(p => p.id === i.productId); if (p) { const c = db.categories.find(c => c.id === p.categoryId); const name = c ? c.name : 'أخرى'; salesByCategory[name] = (salesByCategory[name] || 0) + i.qty * i.price; } }));
    return { totalRevenue, totalProfit, totalCost, totalOrders, deliveredOrders, cancelledOrders, totalProducts, totalCustomers, lowStockProducts, topProducts, salesByDay, salesByCategory, last30 };
  },

  /* Cart */
  getCart() { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } },
  setCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); },

  /* Wishlist */
  getWishlist() { try { return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); } catch { return []; } },
  setWishlist(w) { localStorage.setItem(WISHLIST_KEY, JSON.stringify(w)); },

  /* Reset */
  resetData() { dbCache = null; localStorage.removeItem(DB_KEY); localStorage.removeItem(CART_KEY); localStorage.removeItem(WISHLIST_KEY); localStorage.removeItem(ORDERS_SEEN_KEY); return loadDB(); },

  /* Order notifications (admin) */
  getOrdersSeenAt() { const v = +localStorage.getItem(ORDERS_SEEN_KEY); return Number.isFinite(v) ? v : 0; },
  markOrdersSeen(ts) { localStorage.setItem(ORDERS_SEEN_KEY, String(ts || Date.now())); },
  getUnseenOrders() {
    const seenAt = this.getOrdersSeenAt();
    return this.getOrders().filter(o => {
      const t = o.notifiedAt || (o.date ? new Date(o.date).getTime() : 0);
      return t > seenAt;
    });
  },

  /* Admin credentials (hashed) */
  getAdminCreds() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(ADMIN_CREDS_KEY) || 'null'); } catch (e) {}
    if (!raw || !raw.u || !raw.p) {
      raw = { u: simpleHash('Baraa'), p: simpleHash('Baraa') };
      localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify(raw));
    }
    return raw;
  },
  resetAdminCredentials(username, password) {
    localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ u: simpleHash(username || 'Baraa'), p: simpleHash(password || 'Baraa') }));
    try { localStorage.removeItem('anwar_admin_creds_migrated_v1'); } catch (e) {}
  },
  migrateAdminCredentialsIfNeeded() {
    try {
      if (localStorage.getItem('anwar_admin_creds_migrated_v1') === '1') return;
      localStorage.setItem('anwar_admin_creds_migrated_v1', '1');
      this.resetAdminCredentials('Baraa', 'Baraa');
      try { sessionStorage.removeItem('anwar_admin'); } catch (e) {}
    } catch (e) {}
  },
  verifyAdminCredentials(username, password) {
    const c = this.getAdminCreds();
    return c.u === simpleHash(String(username || '')) && c.p === simpleHash(String(password || ''));
  },
  setAdminCredentials(username, password) {
    if (!username || !password) return false;
    localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ u: simpleHash(username), p: simpleHash(password) }));
    return true;
  }
};

/* Expose globally */
window.Store = Store;
