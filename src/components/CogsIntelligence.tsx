import React, { useState, useEffect, useMemo } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, 
  serverTimestamp, doc, setDoc 
} from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, LineChart, Line 
} from 'recharts';
import { 
  Calculator, TrendingUp, DollarSign, Package, ShoppingBag, 
  Layers, AlertTriangle, CheckCircle2, History, ArrowUpRight, 
  ArrowDownRight, Info, Filter, Calendar, Download, RefreshCw, 
  Lock, Unlock, ChevronRight, Search, Sparkles, Building2, Scale
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, isSameMonth } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

// 🛡️ Safe Date Normalizer
const toStandardDate = (raw: any): string => {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const clean = raw.trim().split('T')[0];
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 3) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length === 3 && parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return clean;
  }
  if (raw && typeof raw.toDate === 'function') {
    try { return format(raw.toDate(), 'yyyy-MM-dd'); } catch { return ''; }
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    try { return format(raw, 'yyyy-MM-dd'); } catch { return ''; }
  }
  return '';
};

// 🛡️ Unit Normalization Helper
const getBaseUnitConversionFactor = (unitStr: string, packSize = 1): { factor: number; baseUnit: string } => {
  const u = (unitStr || '').trim().toLowerCase();
  if (u === 'kg' || u === 'ກິໂລ' || u === 'ກລ') return { factor: 1000, baseUnit: 'g' };
  if (u === 'g' || u === 'ກຣາມ') return { factor: 1, baseUnit: 'g' };
  if (u === 'l' || u === 'litre' || u === 'liter' || u === 'ລິດ') return { factor: 1000, baseUnit: 'ml' };
  if (u === 'ml' || u === 'ມລ') return { factor: 1, baseUnit: 'ml' };
  if (u === 'pack' || u === 'box' || u === 'bag' || u === 'ຖົງ' || u === 'ແພັກ' || u === 'ກ່ອງ') {
    return { factor: packSize > 1 ? packSize : 1, baseUnit: 'pcs' };
  }
  return { factor: 1, baseUnit: u || 'unit' };
};

export default function CogsIntelligence({ selectedBranch, userSettings }: { selectedBranch?: string; userSettings?: any }) {
  const { t, i18n } = useTranslation();

  // Active Sub-tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'wac_roster' | 'analysis' | 'reconciliation'>('dashboard');

  // Firestore Real-time States
  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [recipes, setFsRecipes] = useState<any[]>([]);
  const [menuSales, setFsMenuSales] = useState<any[]>([]);
  const [adjustments, setFsAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Date Range Filter States
  const [timeframePreset, setTimeframePreset] = useState<'month' | 'last_month' | 'all' | 'custom'>('month');
  const [startDate, setStartDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Search & Drilldown Modal State
  const [searchItem, setSearchItem] = useState('');
  const [selectedWacItem, setSelectedWacItem] = useState<any | null>(null);

  // Subscribe to all existing collections
  useEffect(() => {
    const branch = selectedBranch || 'branch_1';
    setLoading(true);

    const unsubP = onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'products'));

    const unsubS = onSnapshot(collection(db, 'supplierPrices'), snap => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'supplierPrices'));

    const unsubT = onSnapshot(collection(db, 'transactions'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === branch));
    }, err => handleFirestoreError(err, OperationType.LIST, 'transactions'));

    const unsubR = onSnapshot(collection(db, 'recipes'), snap => {
      setFsRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'recipes'));

    const unsubM = onSnapshot(collection(db, 'menu_sales'), snap => {
      setFsMenuSales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'menu_sales'));

    const unsubA = onSnapshot(collection(db, 'inventory'), snap => {
      setFsAdjustments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'inventory');
      setLoading(false);
    });

    return () => {
      unsubP();
      unsubS();
      unsubT();
      unsubR();
      unsubM();
      unsubA();
    };
  }, [selectedBranch]);

  // Quick Preset Selector
  const handlePresetSelect = (preset: 'month' | 'last_month' | 'all') => {
    const now = new Date();
    setTimeframePreset(preset);
    if (preset === 'month') {
      setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setEndDate(format(now, 'yyyy-MM-dd'));
    } else if (preset === 'last_month') {
      const prev = subMonths(now, 1);
      setStartDate(format(startOfMonth(prev), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(prev), 'yyyy-MM-dd'));
    } else if (preset === 'all') {
      setStartDate('2020-01-01');
      setEndDate(format(now, 'yyyy-MM-dd'));
    }
  };

  // ================= 🧠 CORE WAC & COGS CALCULATION ENGINE =================
  const wacEngineData = useMemo(() => {
    const startRange = startDate || '2000-01-01';
    const endRange = endDate || '2099-12-31';

    // 1. Sort all purchases chronologically (Oldest ➔ Newest)
    const sortedPurchases = [...supplierPrices].sort((a, b) => {
      const dateA = toStandardDate(a.date || a.createdAt);
      const dateB = toStandardDate(b.date || b.createdAt);
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return String(a.time || '').localeCompare(String(b.time || ''));
    });

    // 2. Build Inventory Movement Ledger per Product
    // ItemID ➔ { history: [], currentQty, currentWAC, currentVal, lastPurchaseCost, ... }
    const itemLedger: { [itemId: string]: any } = {};

    products.forEach(p => {
      const baseConv = getBaseUnitConversionFactor(p.unit, p.packSize || p.boxSize || 1);
      itemLedger[p.id] = {
        item: p,
        itemId: p.id,
        itemName: p.name,
        category: p.category || 'Raw Materials',
        baseUnit: baseConv.baseUnit,
        displayUnit: p.unit || 'unit',
        
        // Cumulative Metrics
        totalPurchasedQty: 0,
        totalPurchasedValue: 0,
        totalUsedQty: 0,
        totalUsedCost: 0,

        // Range Specific Metrics (Selected Period)
        periodPurchasedQty: 0,
        periodPurchasedValue: 0,
        periodUsedQty: 0,
        periodCOGS: 0,
        openingQtyAtPeriod: 0,
        openingWacAtPeriod: 0,
        openingValAtPeriod: 0,

        // Dynamic State Tracker
        runningQty: 0,
        runningValue: 0,
        currentWAC: 0,
        previousWAC: 0,
        lastPurchaseCost: 0,
        lastPurchaseDate: '',
        hasNegativeWarning: false,
        missingCostWarning: false,
        wacHistory: []
      };
    });

    // Process Purchases (Inflow)
    sortedPurchases.forEach(sp => {
      if (!sp.productId || !itemLedger[sp.productId]) return;
      const ledger = itemLedger[sp.productId];
      const pDate = toStandardDate(sp.date || sp.createdAt);

      const qtyPacks = Number(sp.quantity) || 1;
      const subQty = Number(sp.quantityPerUnit) || 1;
      const totalRawUnits = qtyPacks * subQty;

      // Normalize Unit Factor
      const unitConv = getBaseUnitConversionFactor(sp.unit || ledger.displayUnit, subQty);
      const normalizedPurchasedQty = unitConv.factor > 1 && unitConv.baseUnit === ledger.baseUnit
        ? qtyPacks * unitConv.factor
        : totalRawUnits;

      const totalLAK = sp.totalPriceLAK !== undefined
        ? Number(sp.totalPriceLAK || 0)
        : (sp.currency === 'LAK' ? Number(sp.priceOriginal || 0) : Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * qtyPacks;

      const unitCostPurchased = normalizedPurchasedQty > 0 ? totalLAK / normalizedPurchasedQty : 0;

      // Check if opening snapshot for period is reached
      if (pDate < startRange && ledger.openingQtyAtPeriod === 0) {
        ledger.openingQtyAtPeriod = ledger.runningQty;
        ledger.openingWacAtPeriod = ledger.currentWAC;
        ledger.openingValAtPeriod = ledger.runningValue;
      }

      // WAC Calculation: (Old Value + New Value) / (Old Qty + New Qty)
      const prevQty = ledger.runningQty;
      const prevWAC = ledger.currentWAC;
      const prevVal = prevQty * prevWAC;

      const newQty = prevQty + normalizedPurchasedQty;
      const newVal = prevVal + totalLAK;
      const newWAC = newQty > 0 ? newVal / newQty : unitCostPurchased;

      ledger.previousWAC = ledger.currentWAC || newWAC;
      ledger.currentWAC = newWAC;
      ledger.runningQty = newQty;
      ledger.runningValue = newQty * newWAC;
      ledger.lastPurchaseCost = unitCostPurchased;
      ledger.lastPurchaseDate = pDate;
      ledger.totalPurchasedQty += normalizedPurchasedQty;
      ledger.totalPurchasedValue += totalLAK;

      // Period Aggregation
      if (pDate >= startRange && pDate <= endRange) {
        ledger.periodPurchasedQty += normalizedPurchasedQty;
        ledger.periodPurchasedValue += totalLAK;
      }

      // Append Audit History Step
      ledger.wacHistory.push({
        date: pDate,
        type: 'PURCHASE',
        supplier: sp.supplier || 'Vendor',
        billNo: sp.billNo || '-',
        qtyAdded: normalizedPurchasedQty,
        unitCost: unitCostPurchased,
        purchaseVal: totalLAK,
        resultingQty: newQty,
        resultingWAC: newWAC,
        resultingVal: ledger.runningValue
      });
    });

    // Process Stock Adjustments
    adjustments.forEach(adj => {
      if (!adj.productId || !itemLedger[adj.productId]) return;
      const ledger = itemLedger[adj.productId];
      const adjDate = toStandardDate(adj.date || adj.createdAt);
      const adjAmt = Number(adj.amount) || 0;

      if (adjAmt !== 0) {
        const newQty = Math.max(0, ledger.runningQty + adjAmt);
        ledger.runningQty = newQty;
        ledger.runningValue = newQty * ledger.currentWAC;

        ledger.wacHistory.push({
          date: adjDate,
          type: adjAmt > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          supplier: 'Store Audit',
          billNo: 'ADJ',
          qtyAdded: adjAmt,
          unitCost: ledger.currentWAC,
          purchaseVal: Math.abs(adjAmt) * ledger.currentWAC,
          resultingQty: newQty,
          resultingWAC: ledger.currentWAC,
          resultingVal: ledger.runningValue
        });
      }
    });

    // Process Actual Sales & Recipe Consumption (Stock OUT ➔ COGS)
    menuSales.forEach(sale => {
      const sDate = toStandardDate(sale.date || sale.createdAt);
      const itemsSold = sale.itemsSold || {};

      Object.entries(itemsSold).forEach(([recipeId, qtySold]) => {
        const count = Number(qtySold) || 0;
        if (count <= 0) return;

        const recipe = recipes.find(r => r.id === recipeId);
        if (!recipe) return;

        (recipe.ingredients || []).forEach((ing: any) => {
          if (!ing.productId || !itemLedger[ing.productId]) return;
          const ledger = itemLedger[ing.productId];

          const baseAmount = Number(ing.amount) || 0;
          const totalUsed = baseAmount * count;

          // Consume using current WAC
          const currentWAC = ledger.currentWAC || ledger.lastPurchaseCost || 0;
          const cogsGenerated = totalUsed * currentWAC;

          ledger.runningQty -= totalUsed;
          ledger.runningValue = Math.max(0, ledger.runningQty * currentWAC);
          ledger.totalUsedQty += totalUsed;
          ledger.totalUsedCost += cogsGenerated;

          if (ledger.runningQty < 0) ledger.hasNegativeWarning = true;
          if (currentWAC === 0) ledger.missingCostWarning = true;

          if (sDate >= startRange && sDate <= endRange) {
            ledger.periodUsedQty += totalUsed;
            ledger.periodCOGS += cogsGenerated;
          }

          ledger.wacHistory.push({
            date: sDate,
            type: 'SALES_COGS',
            supplier: recipe.menuName || 'Menu Sale',
            billNo: `QTY:${count}`,
            qtyAdded: -totalUsed,
            unitCost: currentWAC,
            purchaseVal: cogsGenerated,
            resultingQty: ledger.runningQty,
            resultingWAC: currentWAC,
            resultingVal: ledger.runningValue
          });
        });
      });
    });

    // 3. Financial Inflow & Revenue within Period
    let periodRevenue = 0;
    let periodOpex = 0;

    transactions.forEach(tx => {
      const dStr = toStandardDate(tx.date || tx.createdAt);
      if (dStr >= startRange && dStr <= endRange) {
        const amt = Number(tx.amount) || 0;
        if (tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales') {
          periodRevenue += amt;
        } else {
          const cat = String(tx.category || '').toLowerCase();
          const isPurchase = cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້');
          if (!isPurchase) {
            periodOpex += amt;
          }
        }
      }
    });

    // 4. Summarize Macro COGS & Financial Statements
    const allItems = Object.values(itemLedger);

    const totalInventoryValuation = allItems.reduce((acc, it) => acc + Math.max(0, it.runningValue), 0);
    const periodTotalPurchases = allItems.reduce((acc, it) => acc + it.periodPurchasedValue, 0);
    const periodActualCOGS = allItems.reduce((acc, it) => acc + it.periodCOGS, 0);

    const openingInventoryVal = allItems.reduce((acc, it) => acc + it.openingValAtPeriod, 0);
    const closingInventoryVal = totalInventoryValuation;

    // Reconciliation Formula: Opening + Purchases - Closing = Expected COGS
    const expectedReconciledCOGS = Math.max(0, openingInventoryVal + periodTotalPurchases - closingInventoryVal);
    const cogsVariance = periodActualCOGS - expectedReconciledCOGS;

    const grossProfit = periodRevenue - periodActualCOGS;
    const grossMargin = periodRevenue > 0 ? (grossProfit / periodRevenue) * 100 : 0;
    const cogsRatio = periodRevenue > 0 ? (periodActualCOGS / periodRevenue) * 100 : 0;
    const netProfit = grossProfit - periodOpex;

    return {
      itemsList: allItems,
      totalInventoryValuation,
      periodTotalPurchases,
      periodActualCOGS,
      periodRevenue,
      periodOpex,
      grossProfit,
      grossMargin,
      cogsRatio,
      netProfit,
      openingInventoryVal,
      closingInventoryVal,
      expectedReconciledCOGS,
      cogsVariance,
      startRange,
      endRange
    };
  }, [products, supplierPrices, recipes, menuSales, adjustments, transactions, startDate, endDate]);

  // Export WAC Excel
  const handleExportWacExcel = () => {
    const headers = [
      'Item Name', 'Category', 'Base Unit', 'Current Stock', 
      'Weighted Avg Cost (WAC ₭)', 'Last Purchase Cost (₭)', 
      'WAC Change %', 'Inventory Valuation (₭)', 'Period Purchases (₭)', 'Period COGS (₭)'
    ];

    const rows = wacEngineData.itemsList.map(it => [
      it.itemName,
      it.category,
      it.baseUnit,
      it.runningQty,
      Math.round(it.currentWAC),
      Math.round(it.lastPurchaseCost),
      it.previousWAC > 0 ? (((it.currentWAC - it.previousWAC) / it.previousWAC) * 100).toFixed(1) + '%' : '0%',
      Math.round(it.runningValue),
      Math.round(it.periodPurchasedValue),
      Math.round(it.periodCOGS)
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'WAC & COGS Analytics');
    writeFile(workbook, `WAC_COGS_Report_${wacEngineData.startRange}_to_${wacEngineData.endRange}.xlsx`);
  };

  return (
    <div className="space-y-6">

      {/* ================= 1. HEADER & DURATION CONTROLLER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <Scale className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {i18n.language === 'la' ? 'ໂມດູນຕົ້ນທຶນສະເລ່ຍ WAC & COGS' : 'WAC & COGS Financial Intelligence'}
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                {selectedBranch === 'branch_1' ? 'Branch 1' : 'Branch 2'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {wacEngineData.startRange} ➔ {wacEngineData.endRange} • Weighted Average Cost Engine
            </p>
          </div>
        </div>

        {/* Preset Range & Date Picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-50 dark:bg-white/5 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-white/10 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={e => {
                setStartDate(toStandardDate(e.target.value));
                setTimeframePreset('custom');
              }}
              className="bg-transparent text-xs font-bold outline-none cursor-pointer"
            />
            <span className="text-slate-400 font-bold">➔</span>
            <input
              type="date"
              value={endDate}
              onChange={e => {
                setEndDate(toStandardDate(e.target.value));
                setTimeframePreset('custom');
              }}
              className="bg-transparent text-xs font-bold outline-none cursor-pointer"
            />
          </div>

          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-xl">
            <button
              onClick={() => handlePresetSelect('month')}
              className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg transition-all ${
                timeframePreset === 'month' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              {i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'}
            </button>
            <button
              onClick={() => handlePresetSelect('last_month')}
              className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg transition-all ${
                timeframePreset === 'last_month' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              {i18n.language === 'la' ? 'ເດືອນກ່ອນ' : 'Last Month'}
            </button>
            <button
              onClick={() => handlePresetSelect('all')}
              className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg transition-all ${
                timeframePreset === 'all' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              {i18n.language === 'la' ? 'ທັງໝົດ' : 'All'}
            </button>
          </div>

          <button
            onClick={handleExportWacExcel}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* ================= 2. EXECUTIVE COGS & INVENTORY KPI CARDS ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        
        {/* Revenue */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
            Revenue
          </span>
          <p className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(wacEngineData.periodRevenue).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 uppercase font-bold">Total Inflows</p>
        </div>

        {/* COGS (Actual Usage at WAC) */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
            COGS (At WAC)
          </span>
          <p className="text-xl font-black font-mono text-rose-500 dark:text-rose-400">
            {Math.round(wacEngineData.periodActualCOGS).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 uppercase font-bold">Goods Sold/Consumed</p>
        </div>

        {/* Gross Margin % */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <Percent className="w-3.5 h-3.5 text-blue-500" />
            Gross Margin
          </span>
          <p className="text-xl font-black font-mono text-blue-600 dark:text-blue-400">
            {wacEngineData.grossMargin.toFixed(1)}%
          </p>
          <p className="text-[9px] text-slate-400 uppercase font-bold">
            GP: {Math.round(wacEngineData.grossProfit).toLocaleString()} ₭
          </p>
        </div>

        {/* COGS Ratio % */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400">
            COGS Ratio
          </span>
          <p className="text-xl font-black font-mono text-amber-600 dark:text-amber-400">
            {wacEngineData.cogsRatio.toFixed(1)}%
          </p>
          <p className="text-[9px] text-slate-400 uppercase font-bold">Target: 30 - 35%</p>
        </div>

        {/* Inventory Valuation (Current Stock * Current WAC) */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-indigo-500 flex items-center gap-1">
            <Package className="w-3.5 h-3.5" />
            Inventory Asset
          </span>
          <p className="text-xl font-black font-mono text-indigo-600 dark:text-indigo-400">
            {Math.round(wacEngineData.totalInventoryValuation).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 uppercase font-bold">Stock at WAC Value</p>
        </div>

        {/* Purchase Value (Inventory Acquired) */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ShoppingBag className="w-3.5 h-3.5" />
            Purchases
          </span>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(wacEngineData.periodTotalPurchases).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 uppercase font-bold">Acquisition Spent</p>
        </div>

      </div>

      {/* ================= 3. SUB-TABS NAVIGATION ================= */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-white/10 pb-3">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
            activeTab === 'dashboard' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
          }`}
        >
          1. COGS Analytics (ບົດວິເຄາະຕົ້ນທຶນ)
        </button>
        <button
          onClick={() => setActiveTab('wac_roster')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
            activeTab === 'wac_roster' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
          }`}
        >
          2. WAC Valuation Roster (ສະຫຼຸບລາຄາສະເລ່ຍ)
        </button>
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
            activeTab === 'reconciliation' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
          }`}
        >
          3. Reconciliation & Month-End (ກວດສອບ Variance)
        </button>
      </div>

      {/* ================= 4. TAB CONTENT: COGS ANALYTICS ================= */}
      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Important Accounting Distinction Box */}
          <div className="lg:col-span-12 p-4 bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500 text-white rounded-xl">
                <Info className="w-5 h-5" />
              </div>
              <div className="text-xs">
                <p className="font-black text-indigo-900 dark:text-indigo-300 uppercase">
                  {i18n.language === 'la' ? 'ຫຼັກການບັນຊີສາກົນ: Purchase (ການຈັດຊື້) ≠ COGS (ຕົ້ນທຶນສິນຄ້າ)' : 'Accounting Standard: Purchases ≠ COGS'}
                </p>
                <p className="text-slate-600 dark:text-slate-300 text-[11px] mt-0.5">
                  {i18n.language === 'la'
                    ? `ຍອດຈັດຊື້ ${Math.round(wacEngineData.periodTotalPurchases).toLocaleString()} ₭ ຖືກບັນທຶກເຂົ້າເປັນມູນຄ່າສິນຄ້າຄົງສາງ (Asset Valuation). ສ່ວນ COGS ຕົວຈິງ (${Math.round(wacEngineData.periodActualCOGS).toLocaleString()} ₭) ຈະຖືກຕັດຈ່າຍສະເພາະວັດຖຸດິບທີ່ຖືກຂາຍ/ໃຊ້ໄປເທົ່ານັ້ນ.`
                    : `Purchases (${Math.round(wacEngineData.periodTotalPurchases).toLocaleString()} ₭) increase Inventory Assets. Real COGS (${Math.round(wacEngineData.periodActualCOGS).toLocaleString()} ₭) represents only what was consumed during operations.`}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Remaining Stock Value:</span>
              <span className="text-sm font-mono font-black text-indigo-600 dark:text-indigo-400">
                {Math.round(wacEngineData.totalInventoryValuation).toLocaleString()} ₭
              </span>
            </div>
          </div>

          {/* Top 5 COGS Drivers */}
          <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-500" />
                <span>{i18n.language === 'la' ? '5 ວັດຖຸດິບທີ່ມີຕົ້ນທຶນ COGS ສູງສຸດ' : 'Top 5 COGS Cost Drivers'}</span>
              </h3>
            </div>

            <div className="space-y-3">
              {[...wacEngineData.itemsList]
                .sort((a, b) => b.periodCOGS - a.periodCOGS)
                .slice(0, 5)
                .map((it, idx) => {
                  const pct = wacEngineData.periodActualCOGS > 0 ? (it.periodCOGS / wacEngineData.periodActualCOGS) * 100 : 0;

                  return (
                    <div key={it.itemId} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-1.5">
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className="text-slate-800 dark:text-white">{idx + 1}. {it.itemName}</span>
                        <span className="font-mono text-rose-600 dark:text-rose-400">
                          {Math.round(it.periodCOGS).toLocaleString()} ₭ ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-black/20 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}></div>
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-400">
                        <span>Used: {it.periodUsedQty.toLocaleString()} {it.baseUnit}</span>
                        <span>Current WAC: {Math.round(it.currentWAC).toLocaleString()} ₭/{it.baseUnit}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Top WAC Cost Inflation Alerts */}
          <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>{i18n.language === 'la' ? 'ແຈ້ງເຕືອນສິນຄ້າທີ່ WAC ເພີ່ມຂຶ້ນ (Inflation Alert)' : 'WAC Cost Inflation Warnings'}</span>
              </h3>
            </div>

            <div className="space-y-3">
              {[...wacEngineData.itemsList]
                .filter(it => it.previousWAC > 0 && it.currentWAC > it.previousWAC)
                .sort((a, b) => (b.currentWAC - b.previousWAC) - (a.currentWAC - a.previousWAC))
                .slice(0, 5)
                .map((it, idx) => {
                  const increasePct = ((it.currentWAC - it.previousWAC) / it.previousWAC) * 100;

                  return (
                    <div key={it.itemId} className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex justify-between items-center">
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{it.itemName}</p>
                        <p className="text-[9.5px] text-slate-400">
                          {Math.round(it.previousWAC).toLocaleString()} ➔ {Math.round(it.currentWAC).toLocaleString()} ₭/{it.baseUnit}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] font-black uppercase">
                          +{increasePct.toFixed(1)}% UP
                        </span>
                      </div>
                    </div>
                  );
                })}

              {[...wacEngineData.itemsList].filter(it => it.previousWAC > 0 && it.currentWAC > it.previousWAC).length === 0 && (
                <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase">
                  ✓ No significant WAC inflation detected across suppliers.
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ================= 5. TAB CONTENT: WAC ROSTER ================= */}
      {activeTab === 'wac_roster' && (
        <div className="high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          
          <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-100 dark:border-white/10 pb-4">
            <div className="relative max-w-xs w-full">
              <input
                type="text"
                placeholder={i18n.language === 'la' ? 'ຄົ້ນຫາສິນຄ້າ...' : 'Search raw materials...'}
                value={searchItem}
                onChange={e => setSearchItem(e.target.value)}
                className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs outline-none"
              />
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
            </div>

            <p className="text-[10px] text-slate-400 font-bold uppercase">
              Showing {wacEngineData.itemsList.length} Material Entities
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-blue-200/40 bg-slate-100/50 dark:bg-white/5">
                <tr>
                  <th className="p-3.5">Material Name</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5 text-right">Current Stock</th>
                  <th className="p-3.5 text-right">Weighted Avg Cost (WAC)</th>
                  <th className="p-3.5 text-right">Last Purchase Cost</th>
                  <th className="p-3.5 text-right">Inventory Valuation</th>
                  <th className="p-3.5 text-center">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {wacEngineData.itemsList
                  .filter(it => it.itemName.toLowerCase().includes(searchItem.toLowerCase()))
                  .map(it => (
                    <tr key={it.itemId} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                      <td className="p-3.5 font-bold text-slate-800 dark:text-white">{it.itemName}</td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 rounded text-[9px] font-black uppercase">
                          {it.category}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold">
                        {it.runningQty.toLocaleString()} <span className="text-[9px] text-slate-400">{it.baseUnit}</span>
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-indigo-600 dark:text-indigo-400">
                        {Math.round(it.currentWAC).toLocaleString()} ₭ <span className="text-[8px] text-slate-400 font-normal">/{it.baseUnit}</span>
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {Math.round(it.lastPurchaseCost).toLocaleString()} ₭
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-slate-900 dark:text-white">
                        {Math.round(it.runningValue).toLocaleString()} ₭
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedWacItem(it)}
                          className="px-2.5 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-lg text-[9.5px] font-black uppercase transition-all cursor-pointer inline-flex items-center gap-1"
                        >
                          <History className="w-3 h-3" />
                          <span>History</span>
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= 6. TAB CONTENT: RECONCILIATION & AUDIT ================= */}
      {activeTab === 'reconciliation' && (
        <div className="bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" />
                <span>{i18n.language === 'la' ? 'ກວດສອບຄວາມຖືກຕ້ອງຂອງ COGS (COGS Variance Reconciliation)' : 'COGS Variance Reconciliation'}</span>
              </h3>
              <p className="text-[9.5px] text-slate-400 font-bold uppercase mt-0.5">
                Formula: Opening Inventory + Purchases - Closing Inventory = Expected COGS
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-1">
              <span className="text-[9.5px] font-black uppercase text-slate-400">1. Opening Stock Value</span>
              <p className="text-lg font-mono font-black text-slate-800 dark:text-white">
                {Math.round(wacEngineData.openingInventoryVal).toLocaleString()} ₭
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-1">
              <span className="text-[9.5px] font-black uppercase text-emerald-500">+ 2. Period Purchases</span>
              <p className="text-lg font-mono font-black text-emerald-600 dark:text-emerald-400">
                +{Math.round(wacEngineData.periodTotalPurchases).toLocaleString()} ₭
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-1">
              <span className="text-[9.5px] font-black uppercase text-indigo-500">- 3. Closing Stock Value</span>
              <p className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400">
                -{Math.round(wacEngineData.closingInventoryVal).toLocaleString()} ₭
              </p>
            </div>

            <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl space-y-1">
              <span className="text-[9.5px] font-black uppercase text-indigo-600 dark:text-indigo-400">= Calculated Expected COGS</span>
              <p className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400">
                {Math.round(wacEngineData.expectedReconciledCOGS).toLocaleString()} ₭
              </p>
            </div>

          </div>

          {/* Variance Comparison Result Box */}
          <div className="p-4 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-200/60 dark:border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <span className="text-[10px] font-black uppercase text-slate-400 block">
                Actual Consumption COGS (At WAC Rate):
              </span>
              <p className="text-xl font-mono font-black text-rose-500 mt-0.5">
                {Math.round(wacEngineData.periodActualCOGS).toLocaleString()} ₭
              </p>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-black uppercase text-slate-400 block">
                COGS Variance (ສ່ວນຕ່າງ):
              </span>
              <p className={`text-xl font-mono font-black ${
                Math.abs(wacEngineData.cogsVariance) > 50000 ? 'text-amber-500' : 'text-emerald-500'
              }`}>
                {Math.round(wacEngineData.cogsVariance).toLocaleString()} ₭
              </p>
              <span className="text-[9px] font-bold text-slate-400 uppercase">
                {Math.abs(wacEngineData.cogsVariance) > 50000 ? '⚠️ Review Required (Spillage/Waste)' : '✓ Balanced'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ================= 7. WAC TRANSACTION DRILLDOWN MODAL ================= */}
      {selectedWacItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col max-h-[85vh] space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div>
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-indigo-500" />
                  <span>WAC History: {selectedWacItem.itemName}</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                  Current WAC: {Math.round(selectedWacItem.currentWAC).toLocaleString()} ₭ / {selectedWacItem.baseUnit}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedWacItem(null)} className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl cursor-pointer">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
                  <tr>
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Activity</th>
                    <th className="p-2.5 text-right">Quantity</th>
                    <th className="p-2.5 text-right">Rate Cost</th>
                    <th className="p-2.5 text-right">Resulting WAC</th>
                    <th className="p-2.5 text-right">Resulting Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {(selectedWacItem.wacHistory || []).map((step: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5">
                      <td className="p-2.5 text-slate-400 font-mono">{step.date}</td>
                      <td className="p-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase ${
                          step.type === 'PURCHASE' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                        }`}>
                          {step.type}
                        </span>
                        <span className="text-[9.5px] text-slate-400 ml-1.5">{step.supplier}</span>
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold">
                        {step.qtyAdded > 0 ? `+${step.qtyAdded.toLocaleString()}` : step.qtyAdded.toLocaleString()}
                      </td>
                      <td className="p-2.5 text-right font-mono">{Math.round(step.unitCost).toLocaleString()} ₭</td>
                      <td className="p-2.5 text-right font-mono font-black text-indigo-600 dark:text-indigo-400">
                        {Math.round(step.resultingWAC).toLocaleString()} ₭
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {Math.round(step.resultingVal).toLocaleString()} ₭
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
