import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Package, Edit2, AlertCircle } from 'lucide-react';
import { inventoryAPI } from '@/api/index';
import SearchBar from '@/components/pos-ui/SearchBar';

interface Ingredient {
  id: number;
  name: string;
  unit: string;
  stock: number;
  low_stock_threshold: number;
}

export default function InventoryScreen() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);

  // Add form state
  const [addName, setAddName] = useState('');
  const [addUnit, setAddUnit] = useState('pcs');
  const [addStock, setAddStock] = useState('0');
  const [addThreshold, setAddThreshold] = useState('0');

  // Edit form state
  const [editAction, setEditAction] = useState<'add' | 'subtract' | 'set'>('add');
  const [editAmount, setEditAmount] = useState('');
  const [editThreshold, setEditThreshold] = useState('');

  // Name or unit, so "pcs" narrows to everything counted in pieces.
  const visibleIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ingredients;
    return ingredients.filter(i =>
      String(i.name || '').toLowerCase().includes(q) ||
      String(i.unit || '').toLowerCase().includes(q)
    );
  }, [ingredients, search]);

  useEffect(() => {
    fetchInventory();
  }, []);

  /**
   * FIX (Bug 3): every call in this file used a bare relative `/api/...` URL.
   * Those work through the Vite dev proxy but resolve against `file://` in the
   * packaged Electron app, so Inventory silently did nothing in production.
   * All four call sites now go through inventoryAPI (absolute BASE_URL).
   */
  const fetchInventory = async () => {
    try {
      const data = await inventoryAPI.getAll();
      setIngredients(data);
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName) return;

    try {
      await inventoryAPI.create({
        name: addName,
        unit: addUnit,
        stock: parseFloat(addStock) || 0,
        low_stock_threshold: parseFloat(addThreshold) || 0,
      });
      setShowAddModal(false);
      setAddName('');
      setAddStock('0');
      setAddThreshold('0');
      fetchInventory();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to add ingredient');
    }
  };

  const openEditModal = (ing: Ingredient) => {
    setSelectedIngredient(ing);
    setEditAction('add');
    setEditAmount('');
    setEditThreshold(ing.low_stock_threshold.toString());
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIngredient) return;

    try {
      // 1. Update stock if amount is provided
      if (editAmount !== '') {
        const amt = parseFloat(editAmount);
        if (!isNaN(amt)) {
          const payload = editAction === 'set'
            ? { stock: amt }
            : { action: editAction, amount: amt };

          await inventoryAPI.updateStock(selectedIngredient.id, payload);
        }
      }

      // 2. Update threshold if changed
      const currentThreshold = parseFloat(editThreshold);
      if (!isNaN(currentThreshold) && currentThreshold !== selectedIngredient.low_stock_threshold) {
        await inventoryAPI.updateThreshold(selectedIngredient.id, currentThreshold);
      }

      setShowEditModal(false);
      fetchInventory();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', background: '#F5F2EA', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '24px 32px',
        background: '#FFFFFF',
        borderBottom: '1px solid #EBEBEB',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: '#FEEFD0',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Package size={20} color="#DC2626" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Inventory Management</h1>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0 0' }}>Track and adjust ingredient stock levels</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px', background: '#DC2626', color: '#FFF',
            borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', boxShadow: '0 2px 4px rgba(220,38,38,0.2)'
          }}
        >
          <Plus size={18} /> New Ingredient
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        <div style={{ marginBottom: 20 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search ingredients by name or unit..."
            resultCount={visibleIngredients.length}
            totalCount={ingredients.length}
          />
        </div>
        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #EBEBEB' }}>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingredient</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Stock</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Low Stock Threshold</th>
                <th style={{ padding: '16px 24px', width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#6B7280' }}>Loading inventory...</td>
                </tr>
              ) : visibleIngredients.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#6B7280' }}>
                    {search.trim()
                      ? `No ingredients match "${search.trim()}".`
                      : 'No ingredients found. Add one to get started.'}
                  </td>
                </tr>
              ) : (
                visibleIngredients.map((ing) => {
                  const isLowStock = ing.stock <= ing.low_stock_threshold;
                  return (
                    <tr 
                      key={ing.id} 
                      style={{ borderBottom: '1px solid #EBEBEB', cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => openEditModal(ing)}
                    >
                      <td style={{ padding: '16px 24px', fontWeight: 500, color: '#111827' }}>
                        {ing.name}
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: isLowStock ? '#EF4444' : '#111827',
                            background: isLowStock ? '#FEF2F2' : 'transparent',
                            padding: isLowStock ? '4px 8px' : '0',
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            {isLowStock && <AlertCircle size={14} />}
                            {ing.stock} {ing.unit}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '16px 24px', color: '#6B7280', fontSize: 14 }}>
                        {ing.low_stock_threshold} {ing.unit}
                      </td>
                      <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                        <Edit2 size={16} color="#9CA3AF" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#FFF', borderRadius: 12, width: 400, padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 18, color: '#111827' }}>New Ingredient</h2>
            <form onSubmit={handleAddSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Ingredient Name</label>
                <input required autoFocus value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Tomato Paste" style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Unit</label>
                <input required value={addUnit} onChange={e => setAddUnit(e.target.value)} placeholder="e.g. kg, grams, pcs, ml" style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} />
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Starting Stock</label>
                  <input type="number" step="any" required value={addStock} onChange={e => setAddStock(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Low Threshold</label>
                  <input type="number" step="any" required value={addThreshold} onChange={e => setAddThreshold(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" onClick={() => setShowAddModal(false)} style={{ padding: '10px 16px', background: '#F3F4F6', color: '#374151', borderRadius: 8, border: 'none', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ padding: '10px 16px', background: '#DC2626', color: '#FFF', borderRadius: 8, border: 'none', fontWeight: 600, cursor: 'pointer' }}>Add Ingredient</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedIngredient && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#FFF', borderRadius: 12, width: 400, padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#111827' }}>Adjust {selectedIngredient.name}</h2>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: '#6B7280' }}>Current Stock: <strong style={{ color: '#111827' }}>{selectedIngredient.stock} {selectedIngredient.unit}</strong></p>
            
            <form onSubmit={handleEditSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Stock Adjustment</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select 
                    value={editAction} 
                    onChange={e => setEditAction(e.target.value as any)}
                    style={{ padding: '10px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, background: '#FFF' }}
                  >
                    <option value="add">Add (+)</option>
                    <option value="subtract">Subtract (-)</option>
                    <option value="set">Set to (=)</option>
                  </select>
                  <input 
                    type="number" 
                    step="any" 
                    placeholder="Amount" 
                    autoFocus
                    value={editAmount} 
                    onChange={e => setEditAmount(e.target.value)} 
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} 
                  />
                  <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#6B7280', fontSize: 14, background: '#F3F4F6', borderRadius: 8 }}>
                    {selectedIngredient.unit}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Low Stock Threshold</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input 
                    type="number" 
                    step="any" 
                    required 
                    value={editThreshold} 
                    onChange={e => setEditThreshold(e.target.value)} 
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} 
                  />
                  <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#6B7280', fontSize: 14, background: '#F3F4F6', borderRadius: 8 }}>
                    {selectedIngredient.unit}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" onClick={() => setShowEditModal(false)} style={{ padding: '10px 16px', background: '#F3F4F6', color: '#374151', borderRadius: 8, border: 'none', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ padding: '10px 16px', background: '#DC2626', color: '#FFF', borderRadius: 8, border: 'none', fontWeight: 600, cursor: 'pointer' }}>Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
