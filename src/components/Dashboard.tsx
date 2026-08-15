import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, Activity, BrainCircuit, Loader2, X, Search, 
  ChevronRight, Package, Sparkles, Wallet, CreditCard, 
  Building2, DollarSign, Calendar, Filter, Percent,
  ArrowUpRight, ArrowDownRight, CheckCircle2, History, AlertCircle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, subDays, parseISO, isSameMonth } from 'date-fns';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';

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

  const normalizePayment = (src?: string): 'Cash' | 'Onepay' | 'LDB' => {
    if (!src) return 'Cash';
    const s = src.toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // ================= 📊 FINANCIAL KPIS & PAYMENT CALCULATION =================
  const financialOverview = useMemo(() => {
    const now = new Date();
    const branchId = selectedBranch || 'branch_1';

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
      trends7Days,
      transactionCount: activeTxList.length
    };
  }, [fsTransactions, timeframeMode, selectedBranch]);

  // ================= 📦 INVENTORY HEALTH CALCULATION =================
  const inventoryOverview = useMemo(() => {
    if (fsProducts.length === 0) return { stockHealth: [], lowStockCount: 0, totalProducts: 0 };

    const healthList = fsProducts.map(prod => {
      const inPrices = fsSupplierPrices.filter(sp => sp.productId === prod.id);
      const totalBought = inPrices.reduce((sum, sp) => {
        const qty = Number(sp.quantity) || 0;
        const subQty = Number(sp.quantityPerUnit) || 1;
        return sum + (qty * subQty);
      }, 0);

      const adjs = fsAdjustments.filter(adj => adj.productId === prod.id);
      const adjTotal = adjs.reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);

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

  // ================= 💡 SMART INSIGHTS =================
  const smartInsights = useMemo(() => {
    const list: Array<{ id: string; title: string; desc: string; type: 'warning' | 'success' | 'info' }> = [];

    // Profitability
    if (financialOverview.totalRevenue > 0) {
      if (financialOverview.netProfit > 0 && financialOverview.grossMarginPercent >= 40) {
        list.push({
          id: 'profit-strong',
          title: i18n.language === 'la' ? 'ກຳໄລຂັ້ນຕົ້ນແຂງແກ່ນ (Strong Margin)' : 'Healthy Profit Margin',
          desc: i18n.language === 'la' 
            ? `Gross Margin ສູງເຖິງ ${financialOverview.grossMarginPercent.toFixed(1)}% ແລະ ສ້າງກຳໄລສຸດທິ ${Math.round(financialOverview.netProfit).toLocaleString()} ₭.` 
            : `Gross Margin at ${financialOverview.grossMarginPercent.toFixed(1)}% delivering ${Math.round(financialOverview.netProfit).toLocaleString()} ₭ Net Profit.`,
          type: 'success'
        });
      } else if (financialOverview.netProfit < 0) {
        list.push({
          id: 'profit-loss',
          title: i18n.language === 'la' ? 'ແຈ້ງເຕືອນລາຍຈ່າຍເກີນຍອດຂາຍ' : 'Expense Overrun Alert',
          desc: i18n.language === 'la'
            ? `ລາຍຈ່າຍລວມສູງກວ່າຍອດຂາຍ ${Math.abs(Math.round(financialOverview.netProfit)).toLocaleString()} ₭. ແນະນຳໃຫ້ກວດສອບຕົ້ນທຶນຈັດຊື້.`
            : `Total costs exceed revenue by ${Math.abs(Math.round(financialOverview.netProfit)).toLocaleString()} ₭. Review purchasing ledger.`,
          type: 'warning'
        });
      }
    }

    // Stock Alert
    if (inventoryOverview.lowStockCount > 0) {
      list.push({
        id: 'low-stock-alert',
        title: i18n.language === 'la' ? `ສິນຄ້າໃກ້ໝົດສະຕັອກ (${inventoryOverview.lowStockCount} ລາຍການ)` : `${inventoryOverview.lowStockCount} Items Low in Stock`,
        desc: i18n.language === 'la'
          ? 'ມີວັດຖຸດິບຫຼັກຫຼຸດລະດັບ Min Stock, ແນະນຳໃຫ້ກວດສອບແຖບ Suppliers ເພື່ອຈັດຊື້ດ່ວນ.'
          : 'Essential ingredients below safety levels. Restock soon from Suppliers tab.',
        type: 'warning'
      });
    }

    // Default status
    if (list.length === 0) {
      list.push({
        id: 'system-ready',
        title: i18n.language === 'la' ? 'ລະບົບພ້ອມໃຊ້ງານ ແລະ ເຊື່ອມຕໍ່ Cloud 100%' : 'All Systems Fully Synced',
        desc: i18n.language === 'la'
          ? 'ທຸກທຸລະກຳ ແລະ ສະຕັອກສິນຄ້າຖືກບັນທຶກ ແລະ ຄິດໄລ່ແບບ Real-time ປອດໄພ.'
          : 'All transaction streams and stock movements are synchronized in real time.',
        type: 'info'
      });
    }

    return list;
  }, [financialOverview, inventoryOverview, i18n.language]);

  if (fsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-xs font-bold text-slate-400 uppercase mt-4 tracking-widest">
          {i18n.language === 'la' ? 'ກຳລັງໂຫຼດຂໍ້ມູນ Real-time Dashboard...' : 'Loading Executive Dashboard...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ================= 1. CLEAN TOP HEADER & TIMEFRAME TOGGLE ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <BrainCircuit className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {i18n.language === 'la' ? 'ພາບລວມລະບົບ (Executive Dashboard)' : 'Executive Business Hub'}
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {(selectedBranch || 'branch_1') === 'branch_1' ? (i18n.language === 'la' ? 'ສາຂາ 1' : 'Branch 1') : (i18n.language === 'la' ? 'ສາຂາ 2' : 'Branch 2')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {timeframeMode === 'month' 
                ? (i18n.language === 'la' ? `ສະແດງສະເພາະ: ເດືອນນີ້ (${format(new Date(), 'MMMM yyyy')})` : `Viewing: This Month (${format(new Date(), 'MMMM yyyy')})`)
                : (i18n.language === 'la' ? 'ສະແດງ: ຍອດລວມທັງໝົດ (All-Time Data)' : 'Viewing: All-Time Overall Ledger')}
            </p>
          </div>
        </div>

        {/* Timeframe Switcher */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200/80 dark:border-white/10">
            <button
              type="button"
              onClick={() => setTimeframeMode('month')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                timeframeMode === 'month'
                  ? 'bg-[#052659] text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTimeframeMode('all')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                timeframeMode === 'all'
                  ? 'bg-[#052659] text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ທັງໝົດ' : 'All-Time'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= 2. HERO BENTO ROW (GRAND TOTAL + 4 KPIS) ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* LEFT: GRAND NET CASHFLOW HERO CARD (5 Cols) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-[#052659] via-[#073069] to-[#0b3c7e] text-white p-7 rounded-[2.5rem] shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-48 h-48 bg-blue-400/10 rounded-full -mr-16 -mt-16 blur-2xl pointer-events-none"></div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7eb3ea]">
                {i18n.language === 'la' ? 'ຍອດເງິນຄົງເຫຼືອລວມທັງໝົດ' : 'Net Liquidity Balance'}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-white/10 text-[9px] font-mono font-bold">
                {financialOverview.transactionCount} Tx
              </span>
            </div>

            <div>
              <h3 className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-white">
                {Math.round(financialOverview.totalNetLiquidity).toLocaleString()}
                <span className="text-xl opacity-60 ml-2 font-sans font-bold">₭</span>
              </h3>
            </div>
          </div>

          <div className="pt-6 border-t border-white/10 mt-6 grid grid-cols-2 gap-4">
            <div>
              <span className="text-[9.5px] font-black uppercase text-emerald-400 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                Inflow (ລາຍຮັບ)
              </span>
              <p className="text-lg font-black font-mono text-white mt-0.5">
                +{Math.round(financialOverview.totalRevenue).toLocaleString()} ₭
              </p>
            </div>

            <div>
              <span className="text-[9.5px] font-black uppercase text-rose-300 flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5" />
                Outflow (ລາຍຈ່າຍ)
              </span>
              <p className="text-lg font-black font-mono text-white mt-0.5">
                -{Math.round(financialOverview.totalExpenses).toLocaleString()} ₭
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT: 4 EXECUTIVE METRIC CARDS (7 Cols) */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-2 gap-4">
          
          {/* Revenue */}
          <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {i18n.language === 'la' ? 'ຍອດຂາຍລວມ (Revenue)' : 'Total Revenue'}
            </span>
            <div className="my-2">
              <h4 className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                {Math.round(financialOverview.totalRevenue).toLocaleString()} ₭
              </h4>
            </div>
            <p className="text-[9.5px] text-slate-400 font-bold uppercase">Customer Inflows</p>
          </div>

          {/* COGS Purchasing */}
          <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບ (Purchasing)' : 'COGS / Materials'}
            </span>
            <div className="my-2">
              <h4 className="text-2xl font-black font-mono text-red-500 dark:text-red-400">
                {Math.round(financialOverview.totalPurchasing).toLocaleString()} ₭
              </h4>
            </div>
            <p className="text-[9.5px] text-slate-400 font-bold uppercase">Material Procurement</p>
          </div>

          {/* Gross Margin % */}
          <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5 text-blue-500" />
              {i18n.language === 'la' ? 'ອັດຕາກຳໄລຂັ້ນຕົ້ນ' : 'Gross Margin'}
            </span>
            <div className="my-2">
              <h4 className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400">
                {financialOverview.grossMarginPercent.toFixed(1)}%
              </h4>
            </div>
            <p className="text-[9.5px] text-slate-400 font-bold uppercase">
              GP: {Math.round(financialOverview.grossProfit).toLocaleString()} ₭
            </p>
          </div>

          {/* Net Profit */}
          <div className={`p-5 rounded-3xl border flex flex-col justify-between ${
            financialOverview.netProfit >= 0 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400'
          }`}>
            <span className="text-[10px] font-black uppercase flex items-center gap-1.5">
              {i18n.language === 'la' ? 'ກຳໄລສຸດທິ (Net Profit)' : 'Net Profit'}
            </span>
            <div className="my-2">
              <h4 className="text-2xl font-black font-mono">
                {Math.round(financialOverview.netProfit).toLocaleString()} ₭
              </h4>
            </div>
            <p className="text-[9.5px] opacity-80 font-bold uppercase">
              Est. ROI: {financialOverview.estimatedROI.toFixed(1)}%
            </p>
          </div>

        </div>

      </div>

      {/* ================= 3. PAYMENT LIQUIDITY (Cash, Onepay, LDB) ================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* Cash */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-black uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດໃນມື (Cash)' : 'Cash in Hand'}</span>
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 rounded-md font-bold">Cash</span>
          </div>
          <h4 className="text-2xl font-black font-mono text-slate-900 dark:text-white">
            {Math.round(financialOverview.cashNet).toLocaleString()} ₭
          </h4>
          <div className="flex justify-between text-[10px] font-mono font-bold text-slate-400 pt-2 border-t border-slate-100 dark:border-white/5">
            <span className="text-emerald-500">+{Math.round(financialOverview.cashIncome).toLocaleString()}</span>
            <span className="text-rose-500">-{Math.round(financialOverview.cashExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* OnePay */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-black uppercase text-red-500 dark:text-red-400 flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'BCEL OnePay' : 'BCEL OnePay'}</span>
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-red-500/10 text-red-500 rounded-md font-bold">OnePay</span>
          </div>
          <h4 className="text-2xl font-black font-mono text-slate-900 dark:text-white">
            {Math.round(financialOverview.onepayNet).toLocaleString()} ₭
          </h4>
          <div className="flex justify-between text-[10px] font-mono font-bold text-slate-400 pt-2 border-t border-slate-100 dark:border-white/5">
            <span className="text-emerald-500">+{Math.round(financialOverview.onepayIncome).toLocaleString()}</span>
            <span className="text-rose-500">-{Math.round(financialOverview.onepayExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* LDB */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-black uppercase text-blue-600 dark:text-blue-400 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'ທະນາຄານ LDB' : 'LDB Bank'}</span>
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded-md font-bold">LDB</span>
          </div>
          <h4 className="text-2xl font-black font-mono text-slate-900 dark:text-white">
            {Math.round(financialOverview.ldbNet).toLocaleString()} ₭
          </h4>
          <div className="flex justify-between text-[10px] font-mono font-bold text-slate-400 pt-2 border-t border-slate-100 dark:border-white/5">
            <span className="text-emerald-500">+{Math.round(financialOverview.ldbIncome).toLocaleString()}</span>
            <span className="text-rose-500">-{Math.round(financialOverview.ldbExpense).toLocaleString()}</span>
          </div>
        </div>

      </div>

      {/* ================= 4. EXECUTIVE INSIGHTS & 7-DAY FLOW ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* LEFT: SMART BUSINESS INSIGHTS (5 Cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#073069] p-6 rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3 mb-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
                <span>{i18n.language === 'la' ? 'ບົດວິເຄາະ & Insights ສຳຄັນ' : 'Executive Business Insights'}</span>
              </h3>
              <span className="text-[8.5px] font-black uppercase px-2 py-0.5 bg-primary/10 text-primary rounded-full">
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
                  <h4 className="text-[11px] font-black uppercase tracking-tight flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      insight.type === 'warning' ? 'bg-amber-500' : insight.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}></span>
                    <span>{insight.title}</span>
                  </h4>
                  <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium pl-3">
                    {insight.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex justify-between items-center text-[10px] text-slate-400 font-bold">
            <span>{i18n.language === 'la' ? 'ສິນຄ້າໃນລະບົບ:' : 'Catalog Items:'} {inventoryOverview.totalProducts}</span>
            <span className={inventoryOverview.lowStockCount > 0 ? 'text-amber-500 font-black' : 'text-emerald-500 font-black'}>
              {inventoryOverview.lowStockCount} {i18n.language === 'la' ? 'ໃກ້ໝົດສະຕັອກ' : 'Critical Low'}
            </span>
          </div>
        </div>

        {/* RIGHT: 7-DAY CASHFLOW CHART (7 Cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-[#073069] p-6 rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span>{i18n.language === 'la' ? 'ກະແສເງິນສົດ 7 ວັນລ່າສຸດ' : '7-Day Cashflow Dynamics'}</span>
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

          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialOverview.trends7Days}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="date" tick={{fontSize: 9, fontWeight: 700}} axisLine={false} tickLine={false} />
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

      {/* ================= 5. STOCK HEALTH & RECENT TRANSACTIONS ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* STOCK HEALTH (6 Cols) */}
        <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-6 rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-500" />
              <span>{i18n.language === 'la' ? 'ສະຖານະສະຕັອກສິນຄ້າ (Stock Health)' : 'Inventory Status'}</span>
            </h3>
            <button
              onClick={() => setShowInventoryModal(true)}
              className="text-[9.5px] font-black uppercase text-primary hover:underline flex items-center gap-1"
            >
              {i18n.language === 'la' ? 'ເບິ່ງທັງໝົດ' : 'View All'}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {inventoryOverview.stockHealth.slice(0, 6).map(item => (
              <div key={item.id} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{item.name}</p>
                  <p className="text-[9px] text-slate-400 uppercase font-bold mt-0.5">
                    Min Stock: {item.minStock} {item.unit}
                  </p>
                </div>

                <div className="text-right flex items-center gap-3">
                  <span className="text-xs font-mono font-black text-slate-800 dark:text-white">
                    {item.current} {item.unit}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                    item.status === 'Critical' ? 'bg-red-500 text-white' : item.status === 'Warning' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENT TRANSACTIONS (6 Cols) */}
        <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-6 rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              <span>{i18n.language === 'la' ? 'ທຸລະກຳລ່າສຸດ (Recent Activity)' : 'Recent Transactions'}</span>
            </h3>
            <span className="text-[9.5px] font-bold text-slate-400">
              {fsTransactions.length} logs
            </span>
          </div>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {fsTransactions.slice(0, 6).map(tx => {
              const isIncome = tx.type === 'income';
              const ch = normalizePayment(tx.source);

              return (
                <div key={tx.id} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center">
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

      {/* ================= INVENTORY MODAL ================= */}
      {showInventoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-[2.5rem] p-6 shadow-2xl border border-white/10 space-y-4 max-h-[85vh] flex flex-col">
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
                className="w-full h-10 px-3 pl-8 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs"
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
