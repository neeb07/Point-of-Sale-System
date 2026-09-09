// @ts-nocheck
import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, Pizza, Sandwich, Coffee, Package, Loader2, Drumstick, Soup, Utensils, Wheat, Droplet, Flame } from 'lucide-react';
import { usePOS } from '@/lib/POSContext';
import { MENU_CATEGORIES, DEFAULT_CATEGORY } from '@/lib/constants';
import { useSettings } from '@/lib/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import SearchBar from '@/components/pos-ui/SearchBar';
import useConfirm from '@/components/pos/useConfirm';

/**
 * FIX (Bug 2): this file used to declare 22 invented categories ('Starters',
 * 'Chowmein', 'Steaks', 'Roti/Naan' ...) while the seeded database only ever
 * used six. Anything added here landed in a category that did not exist on
 * the Sale screen, producing an orphan tab with one item in it.
 *
 * The list now comes from @/lib/constants and is merged at render time with
 * whatever categories are genuinely live in the database, so the two can
 * never disagree again.
 */
export const categoriesList = MENU_CATEGORIES;

const categoryIcon = {
  'Blaze Special': Flame,
  'Stuff Crust': Pizza,
  'Regular Pizza': Pizza,
  'Burgers': Sandwich,
  'Wraps': Sandwich,
  'Chinese': Utensils,
  'Pasta': Utensils,
  'Fries': Drumstick,
  'Appetizers': Drumstick,
  'Sandwich': Sandwich,
  'Soup': Soup,
  'Drinks': Coffee,
  'Tea': Coffee,
  'Extras': Package,
};

const categoryGradient = {
  'Blaze Special': 'linear-gradient(135deg, rgba(220,38,38,0.32), rgba(127,29,29,0.20))',
  'Stuff Crust':   'linear-gradient(135deg, rgba(185,28,28,0.28), rgba(17,17,17,0.18))',
  'Regular Pizza': 'linear-gradient(135deg, rgba(220,38,38,0.28), rgba(17,17,17,0.14))',
  'Burgers':       'linear-gradient(135deg, rgba(232,163,61,0.30), rgba(220,38,38,0.16))',
  'Wraps':         'linear-gradient(135deg, rgba(17,17,17,0.22), rgba(220,38,38,0.14))',
  'Chinese':       'linear-gradient(135deg, rgba(220,38,38,0.20), rgba(232,163,61,0.18))',
  'Pasta':         'linear-gradient(135deg, rgba(254,239,208,0.80), rgba(220,38,38,0.14))',
  'Fries':         'linear-gradient(135deg, rgba(232,163,61,0.30), rgba(17,17,17,0.14))',
  'Appetizers':    'linear-gradient(135deg, rgba(185,28,28,0.24), rgba(232,163,61,0.18))',
  'Sandwich':      'linear-gradient(135deg, rgba(17,17,17,0.20), rgba(220,38,38,0.14))',
  'Soup':          'linear-gradient(135deg, rgba(254,239,208,0.80), rgba(17,17,17,0.12))',
  'Drinks':        'linear-gradient(135deg, rgba(17,17,17,0.26), rgba(75,85,99,0.18))',
  'Tea':           'linear-gradient(135deg, rgba(254,239,208,0.80), rgba(185,28,28,0.14))',
  'Extras':        'linear-gradient(135deg, rgba(17,17,17,0.20), rgba(220,38,38,0.10))',
};

export default function MenuManagement() {
  const { formatMoney } = useSettings();
  // A manager may look the menu up to answer a customer, but not change it.
  // The backend refuses the writes either way; hiding the controls means they
  // are not offered an action that would only fail.
  const { isAdmin } = useAuth();
  const { menuItems, addMenuItem, updateMenuItem, deleteMenuItem, loading } = usePOS();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editingItem, setEditingItem] = useState(null);

  // FIX (Bug 2): merge the canonical list with categories actually present in
  // the database, so a category added by a previous version still shows up.
  const availableCategories = useMemo(() => {
    const live = menuItems.map(i => i.category).filter(Boolean);
    return Array.from(new Set([...MENU_CATEGORIES, ...live]));
  }, [menuItems]);

  // Match on name or category so "burger" and "Burgers" both narrow the list.
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter(i =>
      String(i.name || '').toLowerCase().includes(q) ||
      String(i.category || '').toLowerCase().includes(q)
    );
  }, [menuItems, search]);

  const openAdd = () => { setEditingItem(null); setModalOpen(true); };
  const openEdit = (item) => { setEditingItem(item); setModalOpen(true); };
  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete this item?',
      message: 'It comes off the menu straight away. Orders that already include it keep their line and their category.',
      confirmLabel: 'Delete it',
      tone: 'danger',
    });
    if (ok) deleteMenuItem(id);
  };

  if (loading) {
    return (
      <div className="flex-1 h-full flex items-center justify-center" style={{ background: '#FFFFFF' }}>
        <div className="animate-spin" style={{ color: '#B91C1C' }}>
          <Loader2 size={32} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto" style={{ padding: 24, background: '#FFFFFF' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
          <h1 style={{ color: '#B91C1C', fontWeight: 700, fontSize: 24 }}>Menu Management</h1>
          {isAdmin && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 transition-all duration-150"
            style={{
              height: 40, padding: '0 20px', borderRadius: 10,
              background: '#B91C1C',
              boxShadow: '0 4px 20px rgba(234, 108, 10, 0.4)',
              color: '#FFFFFF', fontSize: 14, fontWeight: 700,
              border: 'none', cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <Plus size={18} />
            Add New Item
          </button>
          )}
        </div>

        {!isAdmin && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            background: '#FEF3C7', color: '#92400E', fontSize: 13,
          }}>
            View only — changing the menu is restricted to an administrator.
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search items by name or category..."
            resultCount={visibleItems.length}
            totalCount={menuItems.length}
          />
        </div>

        {/* Item List */}
        {visibleItems.map(item => {
          const Icon = categoryIcon[item.category] || Package;
          const gradient = categoryGradient[item.category] || categoryGradient.Extras;
          return (
            <div
              key={item.id}
              className="flex items-center"
              style={{
                background: '#B91C1C',
                borderRadius: 16,
                boxShadow: '0 4px 12px rgba(234, 108, 10, 0.2)',
                padding: 16, marginBottom: 10,
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.2)' }}
              >
                <Icon size={20} color="#FFFFFF" />
              </div>
              <div style={{ marginLeft: 14, flex: 1, minWidth: 0 }}>
                <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 15 }}>{item.name}</div>
                <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{item.category}</div>
                {/* The ingredient line printed under the item on the menu card. */}
                {item.description && (
                  <div
                    style={{
                      color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title={item.description}
                  >
                    {item.description}
                  </div>
                )}
              </div>
              <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 16, marginRight: 16 }}>
                {item.has_variants === 1 ? (
                  <span style={{ fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,0.2)', borderRadius: 12 }}>Multiple Sizes</span>
                ) : (
                  formatMoney(item.price)
                )}
              </div>
              {isAdmin && (
              <>
              <IconBtn
                icon={Pencil}
                hoverBg="rgba(255,255,255,0.2)"
                hoverColor="#FFFFFF"
                defaultColor="rgba(255,255,255,0.8)"
                onClick={() => openEdit(item)}
              />
              <IconBtn
                icon={Trash2}
                hoverBg="rgba(255,255,255,0.2)"
                hoverColor="#FFFFFF"
                defaultColor="rgba(255,255,255,0.8)"
                onClick={() => handleDelete(item.id)}
              />
              </>
              )}
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <ItemModal
          item={editingItem}
          categories={availableCategories}
          onClose={() => setModalOpen(false)}
          onSave={(data) => {
            if (editingItem) {
              updateMenuItem(editingItem.id, data);
            } else {
              addMenuItem(data);
            }
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function IconBtn({ icon: Icon, hoverBg, hoverColor, defaultColor, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center transition-all duration-150"
      style={{
        width: 36, height: 36, borderRadius: 8,
        background: 'transparent',
        border: 'none', cursor: 'pointer', marginLeft: 6,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.querySelector('svg').style.color = hoverColor;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.querySelector('svg').style.color = defaultColor;
      }}
    >
      <Icon size={16} style={{ color: defaultColor, transition: 'color 0.15s' }} />
    </button>
  );
}

function ItemModal({ item, categories = MENU_CATEGORIES, onClose, onSave }) {
  const { currencySymbol } = useSettings();
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item?.price || '');
  // FIX (Bug 2): the default was 'Starters', a category that does not exist.
  const [category, setCategory] = useState(item?.category || DEFAULT_CATEGORY);
  const [imageUrl, setImageUrl] = useState(item?.image_url || '');
  const [description, setDescription] = useState(item?.description || '');
  // Lets staff introduce a genuinely new category without a code change.
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  /*
   * Sizes.
   *
   * An item either has one price or a set of named sizes, never both — a pizza
   * priced at "Small 800, Large 1400" has no meaningful single price, and
   * carrying one anyway is how an item ends up selling for 0. So the toggle
   * swaps which field is asked for rather than showing both.
   */
  const [hasVariants, setHasVariants] = useState(item?.has_variants === 1);
  const [variants, setVariants] = useState(
    (item?.variants || []).map(v => ({ label: v.label || '', price: String(v.price ?? '') })
  ));

  const addVariant = (label = '') =>
    setVariants(v => [...v, { label, price: '' }]);
  const setVariant = (i, field, value) =>
    setVariants(v => v.map((row, n) => (n === i ? { ...row, [field]: value } : row)));
  const removeVariant = (i) =>
    setVariants(v => v.filter((_, n) => n !== i));

  /** The size sets this shop actually uses, so the common case is two clicks. */
  const PRESETS = [
    { label: 'Pizza sizes', sizes: ['Small', 'Medium', 'Large', 'X-Large'] },
    { label: 'Drink sizes', sizes: ['Regular', 'Large'] },
    { label: 'Scoops', sizes: ['1 Scoop', '2 Scoops', '3 Scoops'] },
  ];

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUrl(reader.result?.toString() || '');
      };
      reader.readAsDataURL(file);
    }
  };

  // A size with no name, or no price, would appear on the sale screen as a
  // blank button that sells for nothing.
  const usableVariants = variants
    .map(v => ({ label: v.label.trim(), price: Number(v.price) }))
    .filter(v => v.label && Number.isFinite(v.price) && v.price > 0);

  const canSave = name.trim() && (hasVariants ? usableVariants.length > 0 : Boolean(price));

  const handleSave = () => {
    if (!canSave) return;
    const finalCategory = addingCategory && newCategory.trim()
      ? newCategory.trim()
      : category;
    if (!finalCategory) return;
    onSave({
      name: name.trim(),
      // An item with sizes carries no base price of its own; each size has one.
      price: hasVariants ? 0 : (Number(price) || 0),
      category: finalCategory,
      image_url: imageUrl,
      description: description.trim() || null,
      has_variants: hasVariants,
      variants: hasVariants
        ? usableVariants.map((v, i) => ({ ...v, sort_order: i }))
        : [],
    });
  };

  const inputStyle = {
    width: '100%', height: 44,
    background: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: 10, color: '#111827',
    fontSize: 14, padding: '0 14px',
    outline: 'none', fontFamily: 'Inter, sans-serif',
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 460, padding: 28,
          background: '#111111',
          border: '1px solid #DC2626',
          borderRadius: 16,
          boxShadow: '0 10px 25px rgba(17,17,17,0.45)',
        }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
          <h2 style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 18 }}>
            {item ? 'Edit Item' : 'Add New Item'}
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={20} color="#FFFFFF" />
          </button>
        </div>

        {/* Name */}
        <label style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Item Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Enter item name"
          style={{ ...inputStyle, marginBottom: 16 }}
          onFocus={e => { e.currentTarget.style.border = '1px solid #FFFFFF'; }}
          onBlur={e => { e.currentTarget.style.border = '1px solid #E5E7EB'; }}
        />

        {/* Sizes, or a single price — never both. */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          color: '#FFFFFF', fontSize: 13, fontWeight: 600, marginBottom: 14,
        }}>
          <input
            type="checkbox"
            checked={hasVariants}
            onChange={e => {
              setHasVariants(e.target.checked);
              // Offer a first row immediately: an empty list with a checkbox
              // above it reads as broken rather than as waiting for input.
              if (e.target.checked && variants.length === 0) addVariant();
            }}
            style={{ width: 16, height: 16, accentColor: '#DC2626', cursor: 'pointer' }}
          />
          This item comes in different sizes
        </label>

        {hasVariants ? (
          <div style={{ marginBottom: 16 }}>
            {variants.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 10 }}>
                Add at least one size, each with its own price.
              </div>
            )}

            {variants.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={v.label}
                  onChange={e => setVariant(i, 'label', e.target.value)}
                  placeholder="Size (e.g. Large)"
                  style={{ ...inputStyle, flex: 2, marginBottom: 0 }}
                  onFocus={e => { e.currentTarget.style.border = '1px solid #FFFFFF'; }}
                  onBlur={e => { e.currentTarget.style.border = '1px solid #E5E7EB'; }}
                />
                <input
                  type="number"
                  value={v.price}
                  onChange={e => setVariant(i, 'price', e.target.value)}
                  placeholder={currencySymbol}
                  style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                  onFocus={e => { e.currentTarget.style.border = '1px solid #FFFFFF'; }}
                  onBlur={e => { e.currentTarget.style.border = '1px solid #E5E7EB'; }}
                />
                <button
                  onClick={() => removeVariant(i)}
                  title="Remove this size"
                  style={{
                    width: 42, borderRadius: 8, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.25)', color: '#FCA5A5',
                    cursor: 'pointer', fontSize: 18, lineHeight: 1,
                  }}
                >
                  &times;
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button
                onClick={() => addVariant()}
                style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
                  color: '#FFFFFF', cursor: 'pointer',
                }}
              >
                + Add size
              </button>

              {/*
                The size sets this shop actually uses. Typing "Small, Medium,
                Large, X-Large" by hand for every pizza is where inconsistent
                spellings come from, and a deal that looks for "Large" does not
                match an item saved as "large".
              */}
              {variants.length === 0 && PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setVariants(p.sizes.map(sz => ({ label: sz, price: '' })))}
                  style={{
                    padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: 'rgba(220,38,38,0.15)', border: '1px solid #DC2626',
                    color: '#FCA5A5', cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <label style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Price ({currencySymbol})
            </label>
            <input
              type="number"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="0"
              style={{ ...inputStyle, marginBottom: 16 }}
              onFocus={e => { e.currentTarget.style.border = '1px solid #FFFFFF'; }}
              onBlur={e => { e.currentTarget.style.border = '1px solid #E5E7EB'; }}
            />
          </>
        )}

        {/* Category */}
        <label style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Category</label>
        <select
          value={addingCategory ? '__new__' : category}
          onChange={e => {
            if (e.target.value === '__new__') {
              setAddingCategory(true);
            } else {
              setAddingCategory(false);
              setNewCategory('');
              setCategory(e.target.value);
            }
          }}
          style={{
            ...inputStyle, marginBottom: 16,
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23111827' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 14px center',
          }}
          onFocus={e => { e.currentTarget.style.border = '1px solid #FFFFFF'; }}
          onBlur={e => { e.currentTarget.style.border = '1px solid #E5E7EB'; }}
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
          <option value="__new__">+ Add new category…</option>
        </select>

        {addingCategory && (
          <input
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            placeholder="New category name"
            autoFocus
            style={{ ...inputStyle, marginBottom: 16 }}
            onFocus={e => { e.currentTarget.style.border = '1px solid #FFFFFF'; }}
            onBlur={e => { e.currentTarget.style.border = '1px solid #E5E7EB'; }}
          />
        )}

        {/* Image Upload */}
        <label style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Item Image</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          style={{
            width: '100%', marginBottom: 24,
            color: '#FFFFFF', fontSize: 13,
            padding: '8px 0'
          }}
        />
        {imageUrl && (
          <div style={{ marginBottom: 24 }}>
            <img src={imageUrl} alt="Preview" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #E5E7EB' }} />
          </div>
        )}

        {/* The ingredient line from the printed menu. Optional — most items
            outside the pizzas do not carry one on the card. */}
        <label style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="e.g. Mix Cheese, Chicken Tikka, Pizza Sauce, Capsicum"
          style={{ ...inputStyle, height: 'auto', padding: '10px 12px', marginBottom: 24, resize: 'vertical' }}
        />

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center transition-all duration-150"
            style={{
              height: 42, borderRadius: 10,
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#FFFFFF', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 flex items-center justify-center transition-all duration-150"
            style={{
              height: 42, borderRadius: 10,
              // Disabled rather than silently doing nothing, which is what it
              // used to do when a required field was empty.
              background: canSave ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: 'none', color: '#B91C1C', fontSize: 14, fontWeight: 700,
              cursor: canSave ? 'pointer' : 'not-allowed', fontFamily: 'Inter, sans-serif',
            }}
          >
            {canSave ? 'Save Item' : (hasVariants ? 'Add a size first' : 'Name and price needed')}
          </button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}