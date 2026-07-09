import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, Tag, X, Upload, Package, ChevronDown } from 'lucide-react';
import { dealsAPI, menuAPI } from '../api/index';

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
}

interface DealItem {
  menu_item_id: number;
  name: string;
  price: number;
  category: string;
  quantity: number;
}

interface Deal {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  active: number;
  items: DealItem[];
}

const ORANGE = '#F97316';
const ORANGE_LIGHT = '#FFF7ED';
const ORANGE_BORDER = '#FED7AA';
const GRAY_BORDER = '#E5E7EB';
const TEXT_DARK = '#111827';
const TEXT_GRAY = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const WHITE = '#FFFFFF';
const RED = '#EF4444';
const GREEN = '#22C55E';

export default function Deals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formImage, setFormImage] = useState<string | null>(null);
  const [formItems, setFormItems] = useState<DealItem[]>([]);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [dealsData, menuData] = await Promise.all([
        dealsAPI.getAll(),
        menuAPI.getAll(),
      ]);
      setDeals(dealsData as Deal[]);
      setMenuItems(menuData as MenuItem[]);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingDeal(null);
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormImage(null);
    setFormItems([]);
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (deal: Deal) => {
    setEditingDeal(deal);
    setFormName(deal.name);
    setFormDescription(deal.description || '');
    setFormPrice(String(deal.price));
    setFormImage(deal.image_url);
    setFormItems(deal.items.map(i => ({ ...i })));
    setFormError('');
    setModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setFormImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const addItemToDeal = (menuItem: MenuItem) => {
    const existing = formItems.find(i => i.menu_item_id === menuItem.id);
    if (existing) {
      setFormItems(prev => prev.map(i =>
        i.menu_item_id === menuItem.id ? { ...i, quantity: i.quantity + 1 } : i
      ));
    } else {
      setFormItems(prev => [...prev, {
        menu_item_id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        category: menuItem.category,
        quantity: 1,
      }]);
    }
    setItemPickerOpen(false);
  };

  const updateItemQty = (menu_item_id: number, qty: number) => {
    if (qty <= 0) {
      setFormItems(prev => prev.filter(i => i.menu_item_id !== menu_item_id));
    } else {
      setFormItems(prev => prev.map(i =>
        i.menu_item_id === menu_item_id ? { ...i, quantity: qty } : i
      ));
    }
  };

  const handleSave = async () => {
    if (!formName.trim()) { setFormError('Deal name is required'); return; }
    if (!formPrice || isNaN(Number(formPrice)) || Number(formPrice) <= 0) { setFormError('Valid price is required'); return; }
    if (formItems.length === 0) { setFormError('Add at least one item to the deal'); return; }

    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim(),
        price: Number(formPrice),
        image_url: formImage,
        items: formItems.map(i => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
      };

      if (editingDeal) {
        await dealsAPI.update(editingDeal.id, payload);
      } else {
        await dealsAPI.create(payload);
      }

      await loadData();
      setModalOpen(false);
    } catch (err) {
      setFormError('Failed to save deal. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await dealsAPI.delete(id);
      setDeals(prev => prev.filter(d => d.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const originalPrice = formItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const savings = originalPrice - Number(formPrice || 0);

  return (
    <div style={{ flex: 1, background: '#F9FAFB', overflowY: 'auto', padding: 24 }}>

      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>Deals</h1>
          <p style={{ fontSize: 13, color: TEXT_GRAY, margin: '4px 0 0 0' }}>
            Create and manage combo deals and special offers
          </p>
        </div>
        <button
          onClick={openAddModal}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: ORANGE, color: WHITE,
            border: 'none', borderRadius: 10,
            padding: '10px 20px', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#EA580C')}
          onMouseLeave={e => (e.currentTarget.style.background = ORANGE)}
        >
          <Plus size={18} />
          Add Deal
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${ORANGE_BORDER}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && deals.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 80, gap: 12,
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: ORANGE_LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Tag size={32} color={ORANGE} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>No deals yet</h3>
          <p style={{ fontSize: 14, color: TEXT_GRAY, margin: 0 }}>Create your first combo deal to get started</p>
          <button
            onClick={openAddModal}
            style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
              background: ORANGE, color: WHITE, border: 'none',
              borderRadius: 10, padding: '10px 24px',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={16} /> Create Deal
          </button>
        </div>
      )}

      {/* Deals List */}
      {!loading && deals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {deals.map(deal => {
            const originalTotal = deal.items.reduce((s, i) => s + i.price * i.quantity, 0);
            const savingsAmt = originalTotal - deal.price;
            const savingsPct = originalTotal > 0 ? Math.round((savingsAmt / originalTotal) * 100) : 0;

            return (
              <div
                key={deal.id}
                style={{
                  background: WHITE,
                  border: `1px solid ${GRAY_BORDER}`,
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  transition: 'box-shadow 150ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)')}
              >
                {/* Image */}
                <div style={{
                  width: 90, height: 90, borderRadius: 12, flexShrink: 0,
                  background: ORANGE_LIGHT, overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${ORANGE_BORDER}`,
                }}>
                  {deal.image_url ? (
                    <img src={deal.image_url} alt={deal.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Tag size={28} color={ORANGE} />
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: TEXT_DARK }}>{deal.name}</span>
                    {savingsPct > 0 && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
                        background: '#DCFCE7', color: '#16A34A',
                      }}>
                        {savingsPct}% OFF
                      </span>
                    )}
                  </div>

                  {deal.description && (
                    <p style={{ fontSize: 13, color: TEXT_GRAY, margin: '0 0 6px 0', lineHeight: 1.4 }}>
                      {deal.description}
                    </p>
                  )}

                  {/* Included items */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {deal.items.map((item, idx) => (
                      <span key={idx} style={{
                        padding: '2px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500,
                        background: '#F3F4F6', color: TEXT_GRAY,
                        border: `1px solid ${GRAY_BORDER}`,
                      }}>
                        {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                      </span>
                    ))}
                  </div>

                  {/* Price row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: ORANGE }}>
                      Rs. {deal.price.toLocaleString()}
                    </span>
                    {originalTotal > deal.price && (
                      <span style={{ fontSize: 13, color: TEXT_LIGHT, textDecoration: 'line-through' }}>
                        Rs. {originalTotal.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => openEditModal(deal)}
                    style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: WHITE, border: `1px solid ${GRAY_BORDER}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'all 150ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget.style.background = ORANGE_LIGHT); (e.currentTarget.style.borderColor = ORANGE_BORDER); }}
                    onMouseLeave={e => { (e.currentTarget.style.background = WHITE); (e.currentTarget.style.borderColor = GRAY_BORDER); }}
                  >
                    <Pencil size={16} color={TEXT_GRAY} />
                  </button>

                  {deleteConfirm === deal.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleDelete(deal.id)}
                        style={{
                          padding: '0 12px', height: 38, borderRadius: 10,
                          background: RED, color: WHITE, border: 'none',
                          fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        style={{
                          padding: '0 12px', height: 38, borderRadius: 10,
                          background: WHITE, color: TEXT_GRAY,
                          border: `1px solid ${GRAY_BORDER}`,
                          fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(deal.id)}
                      style={{
                        width: 38, height: 38, borderRadius: 10,
                        background: WHITE, border: `1px solid ${GRAY_BORDER}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 150ms',
                      }}
                      onMouseEnter={e => { (e.currentTarget.style.background = '#FEF2F2'); (e.currentTarget.style.borderColor = '#FECACA'); }}
                      onMouseLeave={e => { (e.currentTarget.style.background = WHITE); (e.currentTarget.style.borderColor = GRAY_BORDER); }}
                    >
                      <Trash2 size={16} color={TEXT_LIGHT} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL ── */}
      {modalOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(4px)',
            zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div style={{
            background: WHITE,
            borderRadius: 20,
            width: '100%', maxWidth: 560,
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: `1px solid ${GRAY_BORDER}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexShrink: 0,
            }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>
                  {editingDeal ? 'Edit Deal' : 'Create New Deal'}
                </h2>
                <p style={{ fontSize: 13, color: TEXT_GRAY, margin: '2px 0 0 0' }}>
                  {editingDeal ? 'Update deal details and items' : 'Build a combo deal for your menu'}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  width: 36, height: 36, borderRadius: 9999,
                  background: '#F3F4F6', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={18} color={TEXT_GRAY} />
              </button>
            </div>

            {/* Modal Body — scrollable */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

              {/* Image Upload */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                  Deal Image
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '100%', height: 140, borderRadius: 14,
                    border: `2px dashed ${formImage ? ORANGE : GRAY_BORDER}`,
                    background: formImage ? ORANGE_LIGHT : '#F9FAFB',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', overflow: 'hidden',
                    transition: 'all 150ms',
                  }}
                  onMouseEnter={e => { if (!formImage) (e.currentTarget.style.borderColor = ORANGE); }}
                  onMouseLeave={e => { if (!formImage) (e.currentTarget.style.borderColor = GRAY_BORDER); }}
                >
                  {formImage ? (
                    <img src={formImage} alt="Deal" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Upload size={28} color={TEXT_LIGHT} />
                      <span style={{ fontSize: 13, color: TEXT_LIGHT, fontWeight: 500 }}>Click to upload image</span>
                      <span style={{ fontSize: 11, color: '#D1D5DB' }}>PNG, JPG up to 5MB</span>
                    </div>
                  )}
                </div>
                {formImage && (
                  <button
                    onClick={() => setFormImage(null)}
                    style={{
                      marginTop: 8, fontSize: 12, color: RED,
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}
                  >
                    Remove image
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
              </div>

              {/* Deal Name */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                  Deal Name *
                </label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Family Meal Deal"
                  style={{
                    width: '100%', height: 44, borderRadius: 10,
                    border: `1px solid ${GRAY_BORDER}`,
                    padding: '0 14px', fontSize: 14, color: TEXT_DARK,
                    fontFamily: 'Inter, sans-serif',
                    background: WHITE, outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 150ms',
                  }}
                  onFocus={e => (e.target.style.borderColor = ORANGE)}
                  onBlur={e => (e.target.style.borderColor = GRAY_BORDER)}
                />
              </div>

              {/* Description */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Short description of the deal..."
                  rows={2}
                  style={{
                    width: '100%', borderRadius: 10,
                    border: `1px solid ${GRAY_BORDER}`,
                    padding: '10px 14px', fontSize: 14, color: TEXT_DARK,
                    fontFamily: 'Inter, sans-serif',
                    background: WHITE, outline: 'none', resize: 'none',
                    boxSizing: 'border-box', transition: 'border-color 150ms',
                  }}
                  onFocus={e => (e.target.style.borderColor = ORANGE)}
                  onBlur={e => (e.target.style.borderColor = GRAY_BORDER)}
                />
              </div>

              {/* Deal Price */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                  Deal Price (Rs.) *
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    color: TEXT_GRAY, fontSize: 14, fontWeight: 600, pointerEvents: 'none',
                  }}>Rs.</span>
                  <input
                    type="number"
                    value={formPrice}
                    onChange={e => setFormPrice(e.target.value)}
                    placeholder="0"
                    style={{
                      width: '100%', height: 44, borderRadius: 10,
                      border: `1px solid ${GRAY_BORDER}`,
                      padding: '0 14px 0 46px', fontSize: 16, fontWeight: 700,
                      color: ORANGE, fontFamily: 'Inter, sans-serif',
                      background: WHITE, outline: 'none', boxSizing: 'border-box',
                      transition: 'border-color 150ms',
                    }}
                    onFocus={e => (e.target.style.borderColor = ORANGE)}
                    onBlur={e => (e.target.style.borderColor = GRAY_BORDER)}
                  />
                </div>
                {originalPrice > 0 && Number(formPrice) > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: savings > 0 ? '#16A34A' : RED }}>
                    {savings > 0
                      ? `✓ Customer saves Rs. ${savings.toLocaleString()} (${Math.round((savings/originalPrice)*100)}% off)` 
                      : `⚠ Deal price is higher than individual item prices` 
                    }
                  </div>
                )}
              </div>

              {/* Items Section */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                    Included Items *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setItemPickerOpen(!itemPickerOpen)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 8,
                        background: ORANGE_LIGHT, border: `1px solid ${ORANGE_BORDER}`,
                        color: ORANGE, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      <Plus size={15} /> Add Item
                      <ChevronDown size={14} style={{ transform: itemPickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
                    </button>

                    {/* Item picker dropdown */}
                    {itemPickerOpen && (
                      <div style={{
                        position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                        width: 260, background: WHITE,
                        border: `1px solid ${GRAY_BORDER}`, borderRadius: 12,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        zIndex: 100, maxHeight: 220, overflowY: 'auto',
                      }}>
                        {menuItems.map(item => (
                          <div
                            key={item.id}
                            onClick={() => addItemToDeal(item)}
                            style={{
                              padding: '10px 14px', cursor: 'pointer',
                              borderBottom: `1px solid #F3F4F6`,
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              transition: 'background 100ms',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = ORANGE_LIGHT)}
                            onMouseLeave={e => (e.currentTarget.style.background = WHITE)}
                          >
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{item.name}</div>
                              <div style={{ fontSize: 11, color: TEXT_GRAY }}>{item.category}</div>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: ORANGE }}>
                              {item.has_variants === 1 ? 'Variant Item' : `Rs. ${item.price}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected items */}
                {formItems.length === 0 ? (
                  <div style={{
                    padding: '20px', borderRadius: 12,
                    border: `2px dashed ${GRAY_BORDER}`,
                    textAlign: 'center', color: TEXT_LIGHT, fontSize: 13,
                  }}>
                    No items added yet. Click "Add Item" to build your deal.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {formItems.map(item => (
                      <div key={item.menu_item_id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: TEXT_GRAY }}>
                            {item.has_variants === 1 ? 'Price depends on variant' : `Rs. ${item.price} each`}
                          </div>
                        </div>

                        {/* Qty controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => updateItemQty(item.menu_item_id, item.quantity - 1)}
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: WHITE, border: `1px solid ${GRAY_BORDER}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: 16, color: TEXT_GRAY, lineHeight: 1,
                            }}
                          >−</button>
                          <span style={{ fontSize: 14, fontWeight: 700, color: TEXT_DARK, minWidth: 20, textAlign: 'center' }}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateItemQty(item.menu_item_id, item.quantity + 1)}
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: WHITE, border: `1px solid ${GRAY_BORDER}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: 16, color: TEXT_GRAY, lineHeight: 1,
                            }}
                          >+</button>
                        </div>

                        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_DARK, minWidth: 70, textAlign: 'right' }}>
                          {item.has_variants === 1 ? '-' : `Rs. ${(item.price * item.quantity).toLocaleString()}`}
                        </div>

                        <button
                          onClick={() => updateItemQty(item.menu_item_id, 0)}
                          style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: 'transparent', border: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#FEE2E2')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <X size={14} color={TEXT_LIGHT} />
                        </button>
                      </div>
                    ))}

                    {/* Subtotal */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 14px', borderRadius: 8,
                      background: ORANGE_LIGHT,
                    }}>
                      <span style={{ fontSize: 13, color: TEXT_GRAY }}>Items total</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: TEXT_DARK }}>
                        Rs. {originalPrice.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Error */}
              {formError && (
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: '#FEF2F2', border: '1px solid #FECACA',
                  color: RED, fontSize: 13, marginBottom: 8,
                }}>
                  {formError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: `1px solid ${GRAY_BORDER}`,
              display: 'flex', gap: 10, flexShrink: 0,
            }}>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  flex: 1, height: 44, borderRadius: 10,
                  background: WHITE, border: `1px solid ${GRAY_BORDER}`,
                  color: TEXT_GRAY, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 2, height: 44, borderRadius: 10,
                  background: saving ? '#FED7AA' : ORANGE,
                  border: 'none', color: WHITE,
                  fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {saving ? (
                  <>
                    <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: WHITE, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Saving...
                  </>
                ) : (
                  editingDeal ? 'Update Deal' : 'Create Deal'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
