import { useState } from 'react';
import type { Product } from '../types';
import { Scale, DollarSign, X, Check } from 'lucide-react';

interface ScaleModalProps {
  product: Product | null;
  priceType: 'wholesale' | 'retail';
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (product: Product, quantityInKg: number) => void;
}

export function ScaleModal({ product, priceType, isOpen, onClose, onConfirm }: ScaleModalProps) {
  const [mode, setMode] = useState<'weight' | 'money'>('weight');
  const [grams, setGrams] = useState<string>('250');
  const [money, setMoney] = useState<string>('2000');

  if (!isOpen || !product) return null;

  const unitPrice = priceType === 'wholesale' ? product.wholesale_price : product.retail_price;

  // Weight mode calculation
  const gramsNum = parseFloat(grams) || 0;
  const kgFromGrams = gramsNum / 1000;
  const totalFromWeight = Math.round(kgFromGrams * unitPrice);

  // Money mode calculation
  const moneyNum = parseFloat(money) || 0;
  const kgFromMoney = unitPrice > 0 ? moneyNum / unitPrice : 0;
  const gramsFromMoney = Math.round(kgFromMoney * 1000);

  const handleConfirm = () => {
    if (mode === 'weight') {
      if (kgFromGrams <= 0) return;
      onConfirm(product, Math.round(kgFromGrams * 1000) / 1000);
    } else {
      if (kgFromMoney <= 0) return;
      onConfirm(product, Math.round(kgFromMoney * 1000) / 1000);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div className="flex justify-between items-center border-b pb-3">
          <div className="flex items-center space-x-2">
            <Scale className="text-emerald-600" size={24} />
            <div>
              <h2 className="text-lg font-bold text-slate-900">Balanza y Peso Exacto</h2>
              <p className="text-xs text-slate-500 font-medium">{product.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X size={22} />
          </button>
        </div>

        {/* Mode switcher tabs */}
        <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-2xl">
          <button
            onClick={() => setMode('weight')}
            className={`py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === 'weight' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Scale size={16} />
            <span>Por Peso (Gramos)</span>
          </button>
          <button
            onClick={() => setMode('money')}
            className={`py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === 'money' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <DollarSign size={16} />
            <span>Por Dinero ($)</span>
          </button>
        </div>

        {/* Mode 1: By Weight */}
        {mode === 'weight' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Gramos exactos</label>
              <div className="relative">
                <input
                  type="number"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-emerald-500 rounded-2xl text-lg font-extrabold text-slate-900 focus:outline-none shadow-xs text-right pr-12"
                  placeholder="250"
                  autoFocus
                />
                <span className="absolute right-4 top-3.5 text-sm font-bold text-slate-400">g</span>
              </div>
            </div>

            {/* Quick Pills */}
            <div className="flex flex-wrap gap-1.5">
              {[100, 150, 200, 250, 350, 500, 750, 1000].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setGrams(preset.toString())}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    grams === preset.toString()
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {preset >= 1000 ? `${preset / 1000}kg` : `${preset}g`}
                </button>
              ))}
            </div>

            {/* Result Box */}
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold text-emerald-800 uppercase">Equivalente</p>
                <p className="text-sm font-bold text-slate-800">{kgFromGrams.toFixed(3)} kg</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-emerald-800 uppercase">Total a Cobrar</p>
                <p className="text-2xl font-black text-emerald-700">${totalFromWeight.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>
        ) : (
          /* Mode 2: By Money */
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Importe que pide el cliente</label>
              <div className="relative">
                <span className="absolute left-4 top-3 text-lg font-bold text-slate-400">$</span>
                <input
                  type="number"
                  value={money}
                  onChange={(e) => setMoney(e.target.value)}
                  className="w-full pl-8 pr-4 py-3 border-2 border-emerald-500 rounded-2xl text-lg font-extrabold text-slate-900 focus:outline-none shadow-xs text-right"
                  placeholder="2000"
                  autoFocus
                />
              </div>
            </div>

            {/* Quick Money Pills */}
            <div className="flex flex-wrap gap-1.5">
              {[500, 1000, 1500, 2000, 3000, 5000].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setMoney(preset.toString())}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    money === preset.toString()
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  ${preset.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </button>
              ))}
            </div>

            {/* Result Box */}
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold text-emerald-800 uppercase">Cantidad calculada</p>
                <p className="text-base font-black text-emerald-800">{gramsFromMoney} gramos <span className="text-xs text-slate-500 font-medium">({kgFromMoney.toFixed(3)} kg)</span></p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-emerald-800 uppercase">Total</p>
                <p className="text-2xl font-black text-emerald-700">${moneyNum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>
        )}

        <div className="pt-2 flex justify-end gap-2 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold cursor-pointer transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-extrabold shadow-md flex items-center justify-center gap-1.5 cursor-pointer transition"
          >
            <Check size={18} />
            <span>Confirmar y Agregar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
