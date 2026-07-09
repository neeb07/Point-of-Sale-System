import React, { useState, useEffect } from 'react';
import { usePOS } from '@/lib/POSContext';
import { dealsAPI } from '@/api/index';
import { Tag } from 'lucide-react';

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  image_url?: string;
  has_variants?: number;
  variants?: { id: number; label: string; price: number; sort_order: number }[];
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

interface MenuPanelProps {
  onAddToCart: (item: { id: number; name: string; price: number; isDeal?: boolean }) => void;
  search: string;
}

interface ItemCardProps {
  item: MenuItem;
  onAdd: () => void;
}

interface DealCardProps {
  deal: Deal;
  onAdd: () => void;
}

function getFoodImage(name: string): string {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed += name.charCodeAt(i);
  const prompt = encodeURIComponent(`${name} food dish appetizing`);
  return `https://image.pollinations.ai/prompt/${prompt}?width=300&height=200&nologo=true&seed=${seed}`;
}

export default function MenuPanel({ onAddToCart, search }: MenuPanelProps) {
  const { menuItems } = usePOS();
  const [activeCategory, setActiveCategory] = useState('All');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [selectedVariantItem, setSelectedVariantItem] = useState<MenuItem | null>(null);
  const [selectedTopping, setSelectedTopping] = useState<number>(0);

  useEffect(() => {
    loadDeals();
  }, []);

  const loadDeals = async () => {
    setDealsLoading(true);
    try {
      const dealsData = await dealsAPI.getAll();
      setDeals(dealsData);
    } catch (err) {
      console.error('Failed to load deals:', err);
    } finally {
      setDealsLoading(false);
    }
  };

  const categories = ['All', 'Deals', ...new Set(menuItems.map(item => item.category))];

  const filteredItems = menuItems.filter(item => {
    if (search) return item.name.toLowerCase().includes(search.toLowerCase());
    return activeCategory === 'All' || item.category === activeCategory;
  });

  const showDeals = activeCategory === 'All' || activeCategory === 'Deals';
  const filteredDeals = deals.filter(deal => {
    if (search) return deal.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Category Tabs */}
      <div
        style={{
          height: 46,
          background: '#FFFFFF',
          borderBottom: '1px solid #EBEBEB',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflowX: 'auto',
          flexShrink: 0,
          scrollbarWidth: 'none',
        }}
      >
        {categories.map(cat => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '5px 14px',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#F97316' : '#A3A39A',
                background: isActive ? '#FFF7ED' : 'transparent',
                border: isActive ? '1.5px solid #FED7AA' : '1.5px solid transparent',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 140ms',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.color = '#6B6B63';
                  e.currentTarget.style.background = '#F5F5F0';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.color = '#A3A39A';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Item Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridAutoRows: '190px',
          gap: 14,
          padding: 16,
          overflowY: 'auto',
          flex: 1,
          alignContent: 'start',
          background: '#F5F5F0',
        }}
      >
        {showDeals && filteredDeals.map(deal => (
          <DealCard key={deal.id} deal={deal} onAdd={() => onAddToCart({ id: deal.id, name: deal.name, price: deal.price, isDeal: true })} />
        ))}
        {activeCategory !== 'Deals' && filteredItems.map(item => (
          <ItemCard key={item.id} item={item} onAdd={() => {
            if (item.has_variants === 1 && item.variants && item.variants.length > 0) {
              setSelectedVariantItem(item);
              setSelectedTopping(0);
            } else {
              onAddToCart(item);
            }
          }} />
        ))}
      </div>

      {/* Variant Selection Modal */}
      {selectedVariantItem && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setSelectedVariantItem(null)}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 16,
            width: '90%',
            maxWidth: 400,
            padding: 24,
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111110', margin: 0 }}>
                {selectedVariantItem.name}
              </h2>
              <button 
                onClick={() => setSelectedVariantItem(null)}
                style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#A3A39A', padding: '0 4px' }}
              >
                &times;
              </button>
            </div>
            
            {selectedVariantItem.category.includes('Pizza') && selectedVariantItem.category !== 'New Addition' && selectedVariantItem.category !== 'Deep Dish' && (
              <div style={{ marginBottom: 4 }}>
                <p style={{ fontSize: 14, color: '#6B6B63', margin: '0 0 8px 0', fontWeight: 600 }}>Add Topping:</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { label: 'None', price: 0 },
                    { label: '+100', price: 100 },
                    { label: '+150', price: 150 },
                    { label: '+200', price: 200 }
                  ].map(top => (
                    <button
                      key={top.label}
                      onClick={() => setSelectedTopping(top.price)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 600,
                        border: `1.5px solid ${selectedTopping === top.price ? '#F97316' : '#EBEBEB'}`,
                        background: selectedTopping === top.price ? '#FFF7ED' : '#FFFFFF',
                        color: selectedTopping === top.price ? '#F97316' : '#6B6B63',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {top.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <p style={{ fontSize: 14, color: '#6B6B63', margin: 0, fontWeight: 600 }}>
              {selectedVariantItem.category === 'Ice Cream' ? 'Select a scoop:' : 'Select a size:'}
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {selectedVariantItem.variants?.map(variant => (
                <button
                  key={variant.id}
                  onClick={() => {
                    const toppingText = selectedTopping > 0 ? ` + Topping Rs.${selectedTopping}` : '';
                    onAddToCart({
                      id: selectedVariantItem.id,
                      name: `${selectedVariantItem.name} (${variant.label})${toppingText}`,
                      price: variant.price + selectedTopping
                    });
                    setSelectedVariantItem(null);
                    setSelectedTopping(0);
                  }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderRadius: 12,
                    border: '1.5px solid #EBEBEB',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#F97316';
                    e.currentTarget.style.backgroundColor = '#FFF7ED';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#EBEBEB';
                    e.currentTarget.style.backgroundColor = '#FFFFFF';
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 500, color: '#111110' }}>{variant.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#F97316' }}>Rs. {variant.price.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onAdd }: ItemCardProps) {
  const [pressed, setPressed] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const handleClick = () => {
    setPressed(true);
    onAdd();
    setTimeout(() => setPressed(false), 150);
  };

  return (
    <div
      onClick={handleClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        background: '#FFFFFF',
        border: '1.5px solid #EBEBEB',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 120ms, box-shadow 120ms, border-color 120ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.09)';
        e.currentTarget.style.borderColor = 'rgba(249,115,22,0.30)';
        if (!pressed) e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
        e.currentTarget.style.borderColor = '#EBEBEB';
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {/* Image */}
      <div
        style={{
          height: 118, width: '100%',
          background: '#F5F5F0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {!imgLoaded && !imgError && (
          <div style={{
            width: 88, height: 88, borderRadius: 9999,
            background: '#EBEBEB',
            position: 'absolute',
          }} />
        )}
        {imgError ? (
          <div style={{
            width: 88, height: 88, borderRadius: 9999,
            background: '#F0F0EB',
            border: '3px solid #FFFFFF',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26,
          }}>
            🍽
          </div>
        ) : (
          <img
            src={item.image_url || getFoodImage(item.name)}
            alt={item.name}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            style={{
              width: 88, height: 88, borderRadius: 9999,
              objectFit: 'cover',
              border: '3px solid #FFFFFF',
              boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
              position: 'relative',
            }}
          />
        )}
      </div>

      {/* Text */}
      <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: '#111110',
          textAlign: 'center', marginBottom: 5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: '1.3',
        }}>
          {item.name}
        </div>
        {item.has_variants === 1 ? (
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#FFFFFF', textAlign: 'center',
            background: '#F97316', padding: '2px 8px', borderRadius: 9999, alignSelf: 'center',
            marginTop: 2
          }}>
            {item.category === 'Ice Cream' ? 'Select Scoop' : 'Select Size'}
          </div>
        ) : (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', textAlign: 'center' }}>
            Rs. {item.price.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}

function DealCard({ deal, onAdd }: DealCardProps) {
  const [pressed, setPressed] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const handleClick = () => {
    setPressed(true);
    onAdd();
    setTimeout(() => setPressed(false), 150);
  };

  const originalTotal = deal.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const savingsPct = originalTotal > 0 ? Math.round(((originalTotal - deal.price) / originalTotal) * 100) : 0;

  return (
    <div
      onClick={handleClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        background: '#FFFFFF',
        border: '1.5px solid #EBEBEB',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 120ms, box-shadow 120ms, border-color 120ms',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.09)';
        e.currentTarget.style.borderColor = 'rgba(249,115,22,0.30)';
        if (!pressed) e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
        e.currentTarget.style.borderColor = '#EBEBEB';
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {/* Deal Badge */}
      {savingsPct > 0 && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          background: '#F97316',
          color: '#FFFFFF',
          padding: '2px 8px',
          borderRadius: 9999,
          fontSize: 10,
          fontWeight: 700,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}>
          <Tag size={10} />
          DEAL
        </div>
      )}

      {/* Image */}
      <div
        style={{
          height: 118, width: '100%',
          background: '#FFF7ED',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {!imgLoaded && !imgError && (
          <div style={{
            width: 88, height: 88, borderRadius: 9999,
            background: '#FED7AA',
            position: 'absolute',
          }} />
        )}
        {imgError ? (
          <div style={{
            width: 88, height: 88, borderRadius: 9999,
            background: '#FFF7ED',
            border: '3px solid #FFFFFF',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Tag size={32} color="#F97316" />
          </div>
        ) : (
          <img
            src={deal.image_url || getFoodImage(deal.name)}
            alt={deal.name}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            style={{
              width: 88, height: 88, borderRadius: 9999,
              objectFit: 'cover',
              border: '3px solid #FFFFFF',
              boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
              position: 'relative',
            }}
          />
        )}
      </div>

      {/* Text */}
      <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: '#111110',
          textAlign: 'center', marginBottom: 5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: '1.3',
        }}>
          {deal.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316' }}>
            Rs. {deal.price.toLocaleString()}
          </div>
          {savingsPct > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: '#16A34A' }}>
              {savingsPct}% OFF
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
