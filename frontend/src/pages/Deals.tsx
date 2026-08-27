import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Pencil, Trash2, Tag, X, Upload, Package, ChevronDown } from 'lucide-react';
import { dealsAPI, menuAPI } from '../api/index';
import { DEAL_GROUPS } from '@/lib/constants';
import { useSettings } from '@/lib/SettingsContext';
import SearchBar from '@/components/pos-ui/SearchBar';
import { useAuth } from '@/context/AuthContext';

interface Variant {
  id: number;
  label: string;
  price: number;
  sort_order: number;
}

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  has_variants?: number;
  variants?: Variant[];
}

interface DealItem {
  menu_item_id: number;
  name: string;
  price: number;
  category: string;
  quantity: number;
  has_variants?: number;
  /** FIX (Bug 1): a deal item can pin a specific size/variant. */
  variant_id?: number | null;
  variant_label?: string | null;
  variant_price?: number | null;
}

interface Deal {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  active: number;
  /** FIX (Bug 1): the sub-tab this deal belongs to. */
  deal_group?: string | null;
  items: DealItem[];
}

/** Composite key — the same menu item can appear twice under two variants. */
const itemKey = (menuItemId: number, variantId?: number | null) =>
  `${menuItemId}::${variantId ?? 'base'}`;

/** The unit price actually charged for a deal line. */
const lineUnitPrice = (i: DealItem) =>
  i.variant_id != null && i.variant_price != null ? i.variant_price : i.price;

/** Display name including the variant label when present. */
const lineName = (i: DealItem) =>
  i.variant_label ? `${i.name} (${i.variant_label})` : i.name;

const ORANGE = '#DC2626';
const ORANGE_LIGHT = '#FEEFD0';
const ORANGE_BORDER = '#F2D9A0';
const GRAY_BORDER = '#E5E7EB';
const TEXT_DARK = '#111827';
const TEXT_GRAY = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const WHITE = '#FFFFFF';
const RED = '#EF4444';
const GREEN = '#22C55E';

export default function Deals() {
  const { formatMoney, currencySymbol } = useSettings();
  // Managers look deals up to answer a customer; only an administrator
  // creates, edits or removes them. The backend refuses the writes anyway.
  const { isAdmin } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [search, setSearch] = useState('');

  // Name, description or group — a cashier looking for "student" should find
  // the Student Deal whether that word is in the title or the group label.
  const visibleDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter(d =>
      String(d.name || '').toLowerCase().includes(q) ||
      String(d.description || '').toLowerCase().includes(q) ||
      String(d.deal_group || '').toLowerCase().includes(q)
    );
  }, [deals, search]);
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
  const [formDealGroup, setFormDealGroup] = useState<string>('');
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  /** Item awaiting a size choice before it can be added to the deal. */
  const [variantPickerItem, setVariantPickerItem] = useState<MenuItem | null>(null);
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
    setFormDealGroup('');
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
    // FIX (Bug 1): carry the existing group into the form so saving an edit
    // no longer drops the deal out of its sub-tab.
    setFormDealGroup(deal.deal_group || '');
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

  /**
   * FIX (Bug 1): items with variants used to be added with no size at all,
   * so a deal could only ever reference the base item. Picking such an item
   * now opens a size chooser first.
   */
  const addItemToDeal = (menuItem: MenuItem) => {
    if (menuItem.has_variants === 1 && menuItem.variants && menuItem.variants.length > 0) {
      setVariantPickerItem(menuItem);
      setItemPickerOpen(false);
      return;
    }
    commitItem(menuItem, null);
  };

  const commitItem = (menuItem: MenuItem, variant: Variant | null) => {
    const key = itemKey(menuItem.id, variant?.id ?? null);
    const existing = formItems.find(i => itemKey(i.menu_item_id, i.variant_id) === key);

    if (existing) {
      setFormItems(prev => prev.map(i =>
        itemKey(i.menu_item_id, i.variant_id) === key ? { ...i, quantity: i.quantity + 1 } : i
      ));
    } else {
      setFormItems(prev => [...prev, {
        menu_item_id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        category: menuItem.category,
        quantity: 1,
        has_variants: menuItem.has_variants,
        variant_id: variant?.id ?? null,
        variant_label: variant?.label ?? null,
        variant_price: variant?.price ?? null,
      }]);
    }

    setItemPickerOpen(false);
    setVariantPickerItem(null);
  };

  const updateItemQty = (menu_item_id: number, variant_id: number | null | undefined, qty: number) => {
    const key = itemKey(menu_item_id, variant_id);
    if (qty <= 0) {
      setFormItems(prev => prev.filter(i => itemKey(i.menu_item_id, i.variant_id) !== key));
    } else {
      setFormItems(prev => prev.map(i =>
        itemKey(i.menu_item_id, i.variant_id) === key ? { ...i, quantity: qty } : i
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
        // FIX (Bug 1): deal_group and variant_id are now persisted.
        deal_group: formDealGroup || null,
        items: formItems.map(i => ({
          menu_item_id: i.menu_item_id,
          quantity: i.quantity,
          variant_id: i.variant_id ?? null,
        })),
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

  const originalPrice = formItems.reduce((s, i) => s + lineUnitPrice(i) * i.quantity, 0);
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
        {isAdmin && (
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
        )}
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
          {isAdmin && (
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
          )}
        </div>
      )}

      {!isAdmin && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          background: '#FEF3C7', color: '#92400E', fontSize: 13,
        }}>
          View only — creating and changing deals is restricted to an administrator.
        </div>
      )}

      {!loading && deals.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search deals by name, description or group..."
            resultCount={visibleDeals.length}
            totalCount={deals.length}
          />
        </div>
      )}

      {/* Deals List */}
      {!loading && deals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visibleDeals.map(deal => {
            const originalTotal = deal.items.reduce((s, i) => s + lineUnitPrice(i) * i.quantity, 0);
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
                    {deal.deal_group && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
                        background: ORANGE_LIGHT, color: '#92400E',
                        border: `1px solid ${ORANGE_BORDER}`,
                      }}>
                        {deal.deal_group}
                      </span>
                    )}
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
                        {item.quantity > 1 ? `${item.quantity}x ` : ''}{lineName(item)}
                      </span>
                    ))}
                  </div>

                  {/* Price row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: ORANGE }}>
                      {formatMoney(deal.price)}
                    </span>
                    {originalTotal > deal.price && (
                      <span style={{ fontSize: 13, color: TEXT_LIGHT, textDecoration: 'line-through' }}>
                        {formatMoney(originalTotal)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions — administrator only. */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {isAdmin && (
                  <>
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
                  </>
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

              {/* Deal Group — FIX (Bug 1): was never captured, so deals fell
                  out of their sub-tab on the Sale screen after any edit. */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                  Deal Group
                </label>
                <select
                  value={formDealGroup}
                  onChange={e => setFormDealGroup(e.target.value)}
                  style={{
                    width: '100%', height: 44, borderRadius: 10,
                    border: `1px solid ${GRAY_BORDER}`,
                    padding: '0 12px', fontSize: 14, color: TEXT_DARK,
                    fontFamily: 'Inter, sans-serif',
                    background: WHITE, outline: 'none',
                    boxSizing: 'border-box', cursor: 'pointer',
                  }}
                  onFocus={e => (e.target.style.borderColor = ORANGE)}
                  onBlur={e => (e.target.style.borderColor = GRAY_BORDER)}
                >
                  <option value="">Ungrouped</option>
                  {DEAL_GROUPS.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <div style={{ marginTop: 6, fontSize: 12, color: TEXT_LIGHT }}>
                  Controls which sub-tab this deal appears under on the Sale screen.
                </div>
              </div>

              {/* Deal Price */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_GRAY, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                  Deal Price ({currencySymbol}) *
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    color: TEXT_GRAY, fontSize: 14, fontWeight: 600, pointerEvents: 'none',
                  }}>{currencySymbol}</span>
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
                      ? `✓ Customer saves ${formatMoney(savings)} (${Math.round((savings/originalPrice)*100)}% off)` 
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
                              {item.has_variants === 1 ? 'Choose size' : formatMoney(item.price)}
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
                      <div key={itemKey(item.menu_item_id, item.variant_id)} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{lineName(item)}</div>
                          <div style={{ fontSize: 12, color: TEXT_GRAY }}>
                            {formatMoney(lineUnitPrice(item))} each
                          </div>
                        </div>

                        {/* Qty controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => updateItemQty(item.menu_item_id, item.variant_id, item.quantity - 1)}
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
                            onClick={() => updateItemQty(item.menu_item_id, item.variant_id, item.quantity + 1)}
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: WHITE, border: `1px solid ${GRAY_BORDER}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', fontSize: 16, color: TEXT_GRAY, lineHeight: 1,
                            }}
                          >+</button>
                        </div>

                        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_DARK, minWidth: 70, textAlign: 'right' }}>
                          {formatMoney(lineUnitPrice(item) * item.quantity)}
                        </div>

                        <button
                          onClick={() => updateItemQty(item.menu_item_id, item.variant_id, 0)}
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
                        {formatMoney(originalPrice)}
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
                  background: saving ? '#F2D9A0' : ORANGE,
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
      {/* Variant picker — FIX (Bug 1): lets a deal pin a specific size
          (e.g. "Chicken Tikka Pizza (Small)") instead of the bare item. */}
      {variantPickerItem && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.5)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setVariantPickerItem(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: WHITE, borderRadius: 16, padding: 24,
              width: '90%', maxWidth: 380,
              boxShadow: '0 10px 25px rgba(17,17,17,0.14)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>
                {variantPickerItem.name}
              </h3>
              <button
                onClick={() => setVariantPickerItem(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_LIGHT, padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: TEXT_GRAY, margin: 0 }}>
              Select which size to include in this deal:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {variantPickerItem.variants?.map(v => (
                <button
                  key={v.id}
                  onClick={() => commitItem(variantPickerItem, v)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', borderRadius: 10,
                    border: `1px solid ${GRAY_BORDER}`, background: WHITE,
                    cursor: 'pointer', transition: 'all 150ms',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = ORANGE;
                    e.currentTarget.style.background = ORANGE_LIGHT;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = GRAY_BORDER;
                    e.currentTarget.style.background = WHITE;
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>{v.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: ORANGE }}>
                    {formatMoney(v.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
