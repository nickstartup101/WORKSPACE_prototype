import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart as RechartsPie, Pie, Cell
} from 'recharts';
import { 
  RefreshCcw, TrendingUp, Activity, Zap, Triangle, History, BrainCircuit, 
  Loader2, X, Search, ChevronRight, Package, ArrowUpDown, Sliders, AlertTriangle,
  Database, CloudLightning, DatabaseZap, CheckCircle2, ArrowRightLeft, Sparkles,
  Wallet, CreditCard, Building2, DollarSign, Calendar, Filter, Percent,
  ArrowUpRight, ArrowDownRight, Tag, AlertCircle, ShoppingCart, Layers
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, subDays, parseISO, isSameDay, isSameMonth } from 'date-fns';
import axios from 'axios';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';

interface DashboardProps {
  userSettings: any;
  user?: User | null;
  selectedBranch?: string;
}

export default function Dashboard({ userSettings, user, selectedBranch }: DashboardProps) {
  const { t, i18n } = useTranslation();

  // Timeframe View Switcher: 'month' (This Month) vs 'all' (All-Time)
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');

  // Firestore Collections States
  const [fsProducts, setFsProducts] = useState<any[]>([]);
  const [fsSupplierPrices, setFsSupplierPrices] = useState<any[]>([]);
  const [fsRecipes, setFsRecipes] = useState<any[]>([]);
  const [fsMenuSales, setFsMenuSales] = useState<any[]>([]);
  const [fsAdjustments, setFsAdjustments] = useState<any[]>([]);
  const [fsTransactions, setFsTransactions] = useState<any[]>([]);
  const [fsLoading, setFsLoading] = useState(true);

  // Modal States
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Subscribe to all collections real-time
  useEffect(() => {
    setFsLoading(true);
    const unsubscribes: Array<() => void> = [];

    try {
      const qProducts = query(collection(db, 'products'));
      const qPrices = query(collection(db, 'supplierPrices'));
      const qRecipes = query(collection(db, 'recipes'));
      const qSales = query(collection(db, 'menu_sales'));
      const qAdj = query(collection(db, 'inventory'));
      const qTx = query(collection(db, 'transactions'), orderBy('date', 'desc'));

      unsubscribes.push(onSnapshot(qProducts, (snap) => {
        setFsProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'products')));

      unsubscribes.push(onSnapshot(qPrices, (snap) => {
        setFsSupplierPrices(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'supplierPrices')));

      unsubscribes.push(onSnapshot(qRecipes, (snap) => {
        setFsRecipes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'recipes')));

      unsubscribes.push(onSnapshot(qSales, (snap) => {
        setFsMenuSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'menu_sales')));

      unsubscribes.push(onSnapshot(qAdj, (snap) => {
        setFsAdjustments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'inventory')));

      unsubscribes.push(onSnapshot(qTx, (snap) => {
        setFsTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setFsLoading(false);
      }, error => {
        handleFirestoreError(error, OperationType.LIST, 'transactions');
        setFsLoading(false);
      }));

    } catch (err) {
      console.error("Firestore loading error:", err);
      setFsLoading(false);
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, []);

  // Helper normalizer for payment sources
  const normalizePayment = (src?: string): 'Cash' | 'Onepay' | 'LDB' => {
    if (!src) return 'Cash';
    const s = src.toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // ================= 📊 1. FINANCIAL KPIS & PAYMENT LIQUIDITY CALCULATION =================
  const financialOverview = useMemo(() => {
    const now = new Date();
    const branchId = selectedBranch || 'branch_1';

    // Filter transactions by branch and timeframe
    const activeTxList = fsTransactions.filter(tx => {
      const txBranch = tx.branchId || 'branch_1';
      if (txBranch !== branchId) return false;

      if (timeframeMode === 'all') return true;
      if (!tx.date) return true;
      try {
        const d = parseISO(tx.date);
        return isSameMonth(d, now);
      } catch {
        return true;
      }
    });

    let totalRevenue = 0;
    let totalPurchasing = 0;
    let totalOPEX = 0;

    let cashIncome = 0;
    let cashExpense = 0;
    let onepayIncome = 0;
    let onepayExpense = 0;
    let ldbIncome = 0;
    let ldbExpense = 0;

    // Categories breakdown
    const categoryTotals: { [key: string]: number } = {};

    activeTxList.forEach(tx => {
      const amt = Number(tx.amount) || 0;
      const ch = normalizePayment(tx.source);
      const isIncome = tx.type === 'income' || tx.category?.toLowerCase() === 'sales';

      if (isIncome) {
        totalRevenue += amt;
        if (ch === 'Cash') cashIncome += amt;
        else if (ch === 'Onepay') onepayIncome += amt;
        else if (ch === 'LDB') ldbIncome += amt;
      } else {
        const cat = (tx.category || 'other').toLowerCase();
        const isPurchasing = cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້');

        if (isPurchasing) {
          totalPurchasing += amt;
        } else {
          totalOPEX += amt;
        }

        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;

        if (ch === 'Cash') cashExpense += amt;
        else if (ch === 'Onepay') onepayExpense += amt;
        else if (ch === 'LDB') ldbExpense += amt;
      }
    });

    const totalExpenses = totalPurchasing + totalOPEX;
    const grossProfit = totalRevenue - totalPurchasing;
    const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netProfit = totalRevenue - totalExpenses;
    const estimatedROI = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

    const cashNet = cashIncome - cashExpense;
    const onepayNet = onepayIncome - onepayExpense;
    const ldbNet = ldbIncome - ldbExpense;
    const totalNetLiquidity = cashNet + onepayNet + ldbNet;

    // 7-day trend calculation
    const last7Days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i));
    const trends7Days = last7Days.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayTxs = fsTransactions.filter(tx => {
        const txBranch = tx.branchId || 'branch_1';
        return txBranch === branchId && tx.date === dateStr;
      });

      let income = 0;
      let expense = 0;
      dayTxs.forEach(tx => {
        const amt = Number(tx.amount) || 0;
        if (tx.type === 'income') income += amt;
        else expense += amt;
      });

      return {
        day: format(date, 'EEE'),
        date: format(date, 'dd/MM'),
        income,
        expense
      };
    });

    return {
      totalRevenue,
      totalPurchasing,
      totalOPEX,
      totalExpenses,
      grossProfit,
      grossMarginPercent,
      netProfit,
      estimatedROI,
      cashIncome,
      cashExpense,
      cashNet,
      onepayIncome,
      onepayExpense,
      onepayNet,
      ldbIncome,
      ldbExpense,
      ldbNet,
      totalNetLiquidity,
      categoryTotals,
      trends7Days,
      transactionCount: activeTxList.length
    };
  }, [fsTransactions, timeframeMode, selectedBranch]);

  // ================= 📦 2. INVENTORY HEALTH & BALANCES CALCULATION =================
  const inventoryOverview = useMemo(() => {
    if (fsProducts.length === 0) return { stockHealth: [], lowStockCount: 0, totalProducts: 0 };

    const healthList = fsProducts.map(prod => {
      // Calculate Stock IN
      const inPrices = fsSupplierPrices.filter(sp => sp.productId === prod.id);
      const totalBought = inPrices.reduce((sum, sp) => {
        const qty = Number(sp.quantity) || 0;
        const subQty = Number(sp.quantityPerUnit) || 1;
        return sum + (qty * subQty);
      }, 0);

      // Adjustments
      const adjs = fsAdjustments.filter(adj => adj.productId === prod.id);
      const adjTotal = adjs.reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);

      // Sales Outflow
      let totalSoldUnits = 0;
      fsMenuSales.forEach(sale => {
        const itemsSold = sale.itemsSold || {};
        Object.entries(itemsSold).forEach(([recipeId, qtySold]) => {
          const count = Number(qtySold) || 0;
          if (count <= 0) return;
          const recipe = fsRecipes.find(r => r.id === recipeId);
          if (!recipe) return;
          (recipe.ingredients || []).forEach((ing: any) => {
            if (ing.productId === prod.id) {
              totalSoldUnits += (Number(ing.amount) || 0) * count;
            }
          });
        });
      });

      const currentBalance = Math.max(0, totalBought + adjTotal - totalSoldUnits);
      const minStock = Number(prod.minStock) || 10;
      const isCritical = currentBalance <= minStock;
      const isWarning = currentBalance <= (minStock * 1.5);

      return {
        id: prod.id,
        name: prod.name,
        unit: prod.unit || 'UNIT',
        current: currentBalance,
        minStock,
        status: isCritical ? 'Critical' : isWarning ? 'Warning' : 'Healthy',
        category: prod.category || 'General'
      };
    });

    const lowStockCount = healthList.filter(item => item.status === 'Critical').length;

    return {
      stockHealth: healthList,
      lowStockCount,
      totalProducts: fsProducts.length
    };
  }, [fsProducts, fsSupplierPrices, fsAdjustments, fsMenuSales, fsRecipes]);

  // ================= 💡 3. EXECUTIVE SMART INSIGHTS & AUDIT ALERTS =================
  const smartInsights = useMemo(() => {
    const list: Array<{ id: string; titleLa: string; titleEn: string; descLa: string; descEn: string; type: 'warning' | 'success' | 'info' }> = [];

    // 1. Profitability Insight
    if (financialOverview.totalRevenue > 0) {
      if (financialOverview.netProfit > 0 && financialOverview.grossMarginPercent >= 40) {
        list.push({
          id: 'profit-strong',
          titleLa: 'ອັດຕາກຳໄລຂັ້ນຕົ້ນແຂງແກ່ນ',
          titleEn: 'Strong Profit Margin',
          descLa: `ທຸລະກິດມີ Gross Margin ສູງເຖິງ ${financialOverview.grossMarginPercent.toFixed(1)}% ແລະ ສ້າງກຳໄລສຸດທິ ${Math.round(financialOverview.netProfit).toLocaleString()} ₭.`,
          descEn: `Healthy Gross Margin of ${financialOverview.grossMarginPercent.toFixed(1)}% yielding ${Math.round(financialOverview.netProfit).toLocaleString()} ₭ Net Profit.`,
          type: 'success'
        });
      } else if (financialOverview.netProfit < 0) {
        list.push({
          id: 'profit-loss',
          titleLa: 'ແຈ້ງເຕືອນລາຍຈ່າຍເກີນຍອດຂາຍ',
          titleEn: 'Operating Deficit Alert',
          descLa: `ລາຍຈ່າຍລວມສູງກວ່າຍອດຂາຍ ${Math.abs(Math.round(financialOverview.netProfit)).toLocaleString()} ₭. ຄວນກວດສອບຕົ້ນທຶນການຈັດຊື້ ແລະ ຕັດລາຍຈ່າຍບໍລິຫານ.`,
          descEn: `Total expenses exceed inflows by ${Math.abs(Math.round(financialOverview.netProfit)).toLocaleString()} ₭. Review purchasing rates and non-essential OPEX.`,
          type: 'warning'
        });
      }
    }

    // 2. Low Stock Inventory Alert
    if (inventoryOverview.lowStockCount > 0) {
      list.push({
        id: 'low-stock-alert',
        titleLa: `ພົບສິນຄ້າໃກ້ໝົດສະຕັອກ ${inventoryOverview.lowStockCount} ລາຍການ`,
        titleEn: `${inventoryOverview.lowStockCount} Items Below Safety Stock`,
        descLa: 'ມີວັດຖຸດິບຫຼັກຫຼຸດລະດັບ Min Stock, ແນະນຳໃຫ້ກວດສອບແຖບ Suppliers ເພື່ອຈັດຊື້ເຂົ້າສາງດ່ວນ.',
        descEn: 'Core stock reaching minimum limits. Head to Suppliers tab to schedule replenishment batches.',
        type: 'warning'
      });
    }

    // 3. Payment Method Dominance Insight
    const onepayRatio = financialOverview.totalRevenue > 0 ? (financialOverview.onepayIncome / financialOverview.totalRevenue) * 100 : 0;
    if (onepayRatio > 50) {
      list.push({
        id: 'onepay-dominance',
        titleLa: 'ການຊຳລະຜ່ານ BCEL OnePay ກວມເອົາສ່ວນໃຫຍ່',
        titleEn: 'High Digital QR Adoption',
        descLa: `ລູກຄ້າຊຳລະຜ່ານ BCEL OnePay ເຖິງ ${onepayRatio.toFixed(0)}% ຂອງຍອດຂາຍທັງໝົດ, ຊ່ວຍຫຼຸດຄວາມສ່ຽງໃນການຖືເງິນສົດ.`,
        descEn: `OnePay digital transfers account for ${onepayRatio.toFixed(0)}% of customer inflows, ensuring prompt ledger transparency.`,
        type: 'info'
      });
    }

    // 4. Procurement & COGS Ratio
    const cogsRatio = financialOverview.totalRevenue > 0 ? (financialOverview.totalPurchasing / financialOverview.totalRevenue) * 100 : 0;
    if (cogsRatio > 0 && cogsRatio <= 40) {
      list.push({
        id: 'cogs-healthy',
        titleLa: 'ຕົ້ນທຶນວັດຖຸດິບ (COGS) ຢູ່ໃນເກນມາດຕະຖານ',
        titleEn: 'Optimal COGS Ratio',
        descLa: `ຕົ້ນທຶນການຈັດຊື້ກວມເອົາ ${cogsRatio.toFixed(1)}% ຂອງຍອດຂາຍ (ມາດຕະຖານຄາເຟ: 30-40%).`,
        descEn: `Raw material purchasing represents ${cogsRatio.toFixed(1)}% of revenue (Industry Target: 30-40%).`,
        type: 'success'
      });
    }

    // Fallback default info insight
    if (list.length === 0) {
      list.push({
        id: 'system-ready',
        titleLa: 'ລະບົບ Real-time ເຊື່ອມຕໍ່ສົມບູນ',
        titleEn: 'Real-time System Ready',
        descLa: 'ທຸກທຸລະກຳທາງການເງິນ ແລະ ການເຄື່ອນໄຫວສາງສິນຄ້າຖືກ Sync ກັບ Cloud Database ຢ່າງປອດໄພ.',
        descEn: 'All financials and inventory data movements are continuously synchronized with Cloud Firestore.',
        type: 'info'
      });
    }

    return list;
  }, [financialOverview, inventoryOverview]);

  if (fsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-xs font-bold text-slate-400 uppercase mt-4 tracking-widest">
          {i18n.language === 'la' ? 'ກຳລັງໂຫຼດຂໍ້ມູນ Real-time Dashboard...' : 'Loading Live Executive Dashboard...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ================= 1. TOP HEADER & TIMEFRAME SELECTOR ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 text-primary rounded-2xl">
            <BrainCircuit className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white">
                {i18n.language === 'la' ? 'ພາບລວມລະບົບ & ບົດສະຫຼຸບຜູ້ບໍລິຫານ' : 'Executive Business Dashboard'}
              </h2>
              <span className="text-[8.5px] font-black uppercase px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                {(selectedBranch || 'branch_1') === 'branch_1' ? (i18n.language === 'la' ? 'ສາຂາ 1' : 'Branch 1') : (i18n.language === 'la' ? 'ສາຂາ 2' : 'Branch 2')}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {timeframeMode === 'month' 
                ? (i18n.language === 'la' ? `ກຳລັງສະແດງ: ສະເພາະເດືອນນີ້ (${format(new Date(), 'MMMM yyyy')})` : `Viewing: Current Month (${format(new Date(), 'MMMM yyyy')})`)
                : (i18n.language === 'la' ? 'ກຳລັງສະແດງ: ຍອດລວມທັງໝົດ (All-Time)' : 'Viewing: All-Time Overall Ledger')}
            </p>
          </div>
        </div>

        {/* Timeframe Switcher */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200 dark:border-white/10">
            <button
              type="button"
              onClick={() => setTimeframeMode('month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                timeframeMode === 'month'
                  ? 'bg-[#052659] text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ພາຍໃນເດືອນນີ້' : 'This Month'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTimeframeMode('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                timeframeMode === 'all'
                  ? 'bg-[#052659] text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ຍອດລວມທັງໝົດ' : 'All-Time'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= 2. EXECUTIVE FINANCIAL KPIS ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* Total Revenue */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
            {i18n.language === 'la' ? 'ຍອດຂາຍ (Revenue)' : 'Total Revenue'}
          </span>
          <p className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(financialOverview.totalRevenue).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">
            {financialOverview.transactionCount} Transactions
          </p>
        </div>

        {/* COGS Purchasing */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
            {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບ (Purchasing)' : 'COGS / Materials'}
          </span>
          <p className="text-xl font-black font-mono text-red-500 dark:text-red-400">
            {Math.round(financialOverview.totalPurchasing).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">
            OPEX: {Math.round(financialOverview.totalOPEX).toLocaleString()} ₭
          </p>
        </div>

        {/* Gross Margin % */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <Percent className="w-3.5 h-3.5 text-blue-500" />
            {i18n.language === 'la' ? 'ອັດຕາກຳໄລຂັ້ນຕົ້ນ' : 'Gross Margin'}
          </span>
          <p className="text-xl font-black font-mono text-blue-600 dark:text-blue-400">
            {financialOverview.grossMarginPercent.toFixed(1)}%
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">
            GP: {Math.round(financialOverview.grossProfit).toLocaleString()} ₭
          </p>
        </div>

        {/* Net Profit */}
        <div className={`p-4 sm:p-5 rounded-3xl border space-y-1 ${
          financialOverview.netProfit >= 0 
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' 
            : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
        }`}>
          <span className="text-[9.5px] font-black uppercase block">
            {i18n.language === 'la' ? 'ກຳໄລສຸດທິ (Net Profit)' : 'Net Profit'}
          </span>
          <p className="text-xl font-black font-mono">
            {Math.round(financialOverview.netProfit).toLocaleString()} ₭
          </p>
          <p className="text-[9px] opacity-80 font-bold uppercase">
            Revenue - All Costs
          </p>
        </div>

        {/* Estimated ROI */}
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 sm:p-5 rounded-3xl text-amber-700 dark:text-amber-400 space-y-1">
          <span className="text-[9.5px] font-black uppercase block">
            {i18n.language === 'la' ? 'ຜົນຕອບແທນ ROI' : 'Estimated ROI'}
          </span>
          <p className="text-xl font-black font-mono">
            {financialOverview.estimatedROI.toFixed(1)}%
          </p>
          <p className="text-[9px] opacity-80 font-bold uppercase">
            Return on Total Spent
          </p>
        </div>

      </div>

      {/* ================= 3. PAYMENT LIQUIDITY CARDS (Cash, Onepay, LDB) ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Liquidity Net */}
        <div className="bg-gradient-to-br from-[#052659] to-[#073069] text-white p-5 rounded-3xl shadow-xl space-y-2 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#5483B3]">
              {i18n.language === 'la' ? 'ຍອດເງິນຄົງເຫຼືອລວມທັງໝົດ' : 'Total Net Cashflow'}
            </span>
            <div className="p-2 bg-white/10 rounded-xl">
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-black font-mono tracking-tight">
            {Math.round(financialOverview.totalNetLiquidity).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-blue-200/60 font-bold uppercase">
            In: +{Math.round(financialOverview.totalRevenue).toLocaleString()} | Out: -{Math.round(financialOverview.totalExpenses).toLocaleString()}
          </p>
        </div>

        {/* Cash In Hand */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດ (Cash)' : 'Cash in Hand'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded">Cash</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.cashNet).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialOverview.cashIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialOverview.cashExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* BCEL OnePay */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'BCEL OnePay' : 'OnePay Balance'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded">OnePay</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.onepayNet).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialOverview.onepayIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialOverview.onepayExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* LDB Bank */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ທະນາຄານ LDB' : 'LDB Balance'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded">LDB</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.ldbNet).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialOverview.ldbIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialOverview.ldbExpense).toLocaleString()}</span>
          </div>
        </div>

      </div>

      {/* ================= 4. EXECUTIVE INSIGHTS & WEEKLY CASH FLOW ROW ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT: SMART BUSINESS INSIGHTS (5 Cols) */}
        <div className="lg:col-span-5 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3 mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
                <span>{i18n.language === 'la' ? 'ບົດວິເຄາະ & Insights ສຳຄັນ' : 'Executive Business Insights'}</span>
              </h3>
              <span className="text-[8.5px] font-black uppercase tracking-widest px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                AI Advisory
              </span>
            </div>

            <div className="space-y-3">
              {smartInsights.map(insight => (
                <div
                  key={insight.id}
                  className={`p-3.5 rounded-2xl border space-y-1 transition-all ${
                    insight.type === 'warning'
                      ? 'bg-amber-500/5 border-amber-500/20 text-amber-900 dark:text-amber-300'
                      : insight.type === 'success'
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-900 dark:text-emerald-300'
                        : 'bg-blue-500/5 border-blue-500/20 text-blue-900 dark:text-blue-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      insight.type === 'warning' ? 'bg-amber-500' : insight.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}></div>
                    <h4 className="text-[11px] font-black uppercase tracking-tight">
                      {i18n.language === 'la' ? insight.titleLa : insight.titleEn}
                    </h4>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium pl-3">
                    {i18n.language === 'la' ? insight.descLa : insight.descEn}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex justify-between items-center text-[10px] text-slate-400 font-bold">
            <span>{i18n.language === 'la' ? 'ສະຖານະສະຕັອກສິນຄ້າ:' : 'Active Inventory Items:'} {inventoryOverview.totalProducts}</span>
            <span className={inventoryOverview.lowStockCount > 0 ? 'text-amber-500' : 'text-emerald-500'}>
              {inventoryOverview.lowStockCount} Critical
            </span>
          </div>
        </div>

        {/* RIGHT: 7-DAY INFLOW VS OUTFLOW CHART (7 Cols) */}
        <div className="lg:col-span-7 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4 flex flex-col justify-between">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span>{i18n.language === 'la' ? 'ກະແສເງິນສົດ 7 ວັນລ່າສຸດ (7-Day Cashflow)' : '7-Day Inflow vs Outflow Trend'}</span>
            </h3>
            <div className="flex gap-3 text-[9px] font-black uppercase">
              <span className="flex items-center gap-1 text-emerald-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Inflow
              </span>
              <span className="flex items-center gap-1 text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> Outflow
              </span>
            </div>
          </div>

          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialOverview.trends7Days}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="date" tick={{fontSize: 9}} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#052659', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                  formatter={(val: number) => [`${val.toLocaleString()} ₭`, '']}
                />
                <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* ================= 5. STOCK HEALTH & REAL-TIME ACTIVITY ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* STOCK HEALTH FEED (6 Cols) */}
        <div className="lg:col-span-6 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-500" />
              <span>{i18n.language === 'la' ? 'ສະຖານະສະຕັອກສິນຄ້າ (Stock Health)' : 'Inventory Stock Health'}</span>
            </h3>
            <button
              onClick={() => setShowInventoryModal(true)}
              className="text-[9px] font-black uppercase text-primary hover:underline flex items-center gap-1"
            >
              View Full List
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {inventoryOverview.stockHealth.slice(0, 6).map(item => (
              <div key={item.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{item.name}</p>
                  <p className="text-[9px] text-slate-400 uppercase font-bold mt-0.5">
                    Min Stock: {item.minStock} {item.unit}
                  </p>
                </div>

                <div className="text-right flex items-center gap-3">
                  <div>
                    <p className="text-xs font-mono font-black text-slate-800 dark:text-white">
                      {item.current} <span className="text-[9px] text-slate-400 uppercase">{item.unit}</span>
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase ${
                    item.status === 'Critical' ? 'bg-red-500 text-white' : item.status === 'Warning' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENT TRANSACTION LEDGER FEED (6 Cols) */}
        <div className="lg:col-span-6 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              <span>{i18n.language === 'la' ? 'ທຸລະກຳລ່າສຸດ (Recent Ledger)' : 'Recent Transactions'}</span>
            </h3>
            <span className="text-[9px] font-bold text-slate-400">
              {fsTransactions.length} logs
            </span>
          </div>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {fsTransactions.slice(0, 6).map(tx => {
              const isIncome = tx.type === 'income';
              const ch = normalizePayment(tx.source);

              return (
                <div key={tx.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 flex justify-between items-center">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-7 rounded-full ${isIncome ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate max-w-[160px]">
                        {tx.category || 'Transaction'}
                      </p>
                      <p className="text-[9px] text-slate-400 font-medium">
                        {tx.date} • {tx.time || ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                      ch === 'Cash' ? 'bg-emerald-500/10 text-emerald-600' : ch === 'Onepay' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'
                    }`}>
                      {ch}
                    </span>
                    <p className={`text-xs font-mono font-black ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {isIncome ? '+' : '-'}{Number(tx.amount || 0).toLocaleString()} ₭
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* ================= INVENTORY DETAIL MODAL ================= */}
      {showInventoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-white/10 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-500" />
                <span>Full Inventory Status</span>
              </h3>
              <button type="button" onClick={() => setShowInventoryModal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Search items..."
                className="w-full h-10 px-3 pl-8 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <Search className="absolute left-2.5 top-3 w-4 h-4 text-slate-400" />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {inventoryOverview.stockHealth
                .filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(item => (
                  <div key={item.id} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{item.name}</p>
                      <p className="text-[9px] text-slate-400 uppercase">Min: {item.minStock} {item.unit}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono font-black">{item.current} {item.unit}</span>
                      <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase ${
                        item.status === 'Critical' ? 'bg-red-500 text-white' : item.status === 'Warning' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
