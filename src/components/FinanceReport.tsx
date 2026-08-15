import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart as RePie, Pie, Cell, Legend
} from 'recharts';
import { 
  TrendingUp, DollarSign, Percent, PieChart, BarChart3, 
  ArrowUpRight, ArrowDownRight, Sparkles, Download, Calendar, 
  Filter, Wallet, CreditCard, Building2, ShoppingCart, 
  FileText, CheckCircle2, AlertTriangle, Layers, Award, RefreshCw
} from 'lucide-react';
import { format, isSameMonth, parseISO, subMonths, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { jsPDF } from 'jspdf';
import { useTranslation } from 'react-i18next';

export default function FinanceReport({ selectedBranch }: { selectedBranch?: string }) {
  const { t, i18n } = useTranslation();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Timeframe View Switcher: 'month' (This Month) vs 'last_month' vs 'all'
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'last_month' | 'all'>('month');
  const [selectedMonthStr, setSelectedMonthStr] = useState<string>(format(new Date(), 'yyyy-MM'));

  // Subscribe to real-time collections
  useEffect(() => {
    setLoading(true);
    const branch = selectedBranch || 'branch_1';

    const unsubTx = onSnapshot(query(collection(db, 'transactions'), orderBy('date', 'desc')), (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === branch));
    });

    const unsubSuppliers = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => {
      unsubTx();
      unsubSuppliers();
      unsubProducts();
    };
  }, [selectedBranch]);

  // Normalize channel helper
  const normalizePayment = (src?: string): 'Cash' | 'Onepay' | 'LDB' => {
    if (!src) return 'Cash';
    const s = src.toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // ================= 📊 1. DYNAMIC FINANCIAL CALCULATION & LEGACY COGS EXTRACTOR =================
  const financialData = useMemo(() => {
    const now = new Date();
    const targetDate = timeframeMode === 'last_month' ? subMonths(now, 1) : parseISO(`${selectedMonthStr}-01`);

    const filterByTimeframe = (dateStr?: string) => {
      if (timeframeMode === 'all') return true;
      if (!dateStr) return true;
      try {
        const d = parseISO(dateStr);
        return isSameMonth(d, targetDate);
      } catch {
        return true;
      }
    };

    const activeTransactions = transactions.filter(tx => filterByTimeframe(tx.date));

    // 🌟 SEPARATE LEGACY & MODERN PURCHASING FOR PRECISE COGS (Avoid Duplicate Pulls)
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalSalary = 0;
    let totalRent = 0;
    let totalOperations = 0;
    let totalAdmin = 0;
    let totalOtherExpenses = 0;

    let cashIn = 0, cashOut = 0;
    let onepayIn = 0, onepayOut = 0;
    let ldbIn = 0, ldbOut = 0;

    const importedSupplierPriceIds = new Set<string>();
    activeTransactions.forEach(tx => {
      if (tx.supplierPriceIds && Array.isArray(tx.supplierPriceIds)) {
        tx.supplierPriceIds.forEach((id: string) => importedSupplierPriceIds.add(id));
      }
    });

    // 1. Process Transactions
    activeTransactions.forEach(tx => {
      const amt = Number(tx.amount) || 0;
      const ch = normalizePayment(tx.source);
      const isIncome = tx.type === 'income' || tx.category?.toLowerCase() === 'sales';

      if (isIncome) {
        totalRevenue += amt;
        if (ch === 'Cash') cashIn += amt;
        else if (ch === 'Onepay') onepayIn += amt;
        else if (ch === 'LDB') ldbIn += amt;
      } else {
        const cat = (tx.category || '').toLowerCase();
        const isPurchasing = cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້');

        if (isPurchasing) {
          totalCOGS += amt;
        } else if (cat.includes('salary') || cat.includes('ເງິນເດືອນ')) {
          totalSalary += amt;
        } else if (cat.includes('rent') || cat.includes('ຄ່າເຊົ່າ')) {
          totalRent += amt;
        } else if (cat.includes('operat') || cat.includes('ດຳເນີນງານ') || cat.includes('water') || cat.includes('elect')) {
          totalOperations += amt;
        } else if (cat.includes('admin') || cat.includes('ບໍລິຫານ')) {
          totalAdmin += amt;
        } else {
          totalOtherExpenses += amt;
        }

        if (ch === 'Cash') cashOut += amt;
        else if (ch === 'Onepay') onepayOut += amt;
        else if (ch === 'LDB') ldbOut += amt;
      }
    });

    // 2. Extract any unimported supplierPrices (Legacy purchasing) for complete COGS
    supplierPrices.forEach(sp => {
      if (!sp.date || importedSupplierPriceIds.has(sp.id)) return;
      if (filterByTimeframe(sp.date)) {
        const isNew = sp.totalPriceLAK !== undefined;
        const amt = isNew
          ? Number(sp.totalPriceLAK || 0)
          : (sp.currency === 'LAK' ? Number(sp.priceOriginal || 0) : Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * (Number(sp.quantity) || 1);

        const cat = (sp.category || 'purchasing').toLowerCase();
        if (cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້') || cat === 'purchasing') {
          totalCOGS += amt;
          const ch = normalizePayment(sp.paymentMethod);
          if (ch === 'Cash') cashOut += amt;
          else if (ch === 'Onepay') onepayOut += amt;
          else if (ch === 'LDB') ldbOut += amt;
        }
      }
    });

    // Executive Metrics
    const totalOPEX = totalSalary + totalRent + totalOperations + totalAdmin + totalOtherExpenses;
    const totalExpenses = totalCOGS + totalOPEX;
    const grossProfit = totalRevenue - totalCOGS;
    const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netProfit = totalRevenue - totalExpenses;
    const estimatedROI = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

    // Category Pie Chart Data
    const categoryChartData = [
      { name: 'COGS (ວັດຖຸດິບ)', value: totalCOGS, color: '#ef4444' },
      { name: 'Salary (ເງິນເດືອນ)', value: totalSalary, color: '#f59e0b' },
      { name: 'Rental (ຄ່າເຊົ່າ)', value: totalRent, color: '#3b82f6' },
      { name: 'Operations (ດຳເນີນງານ)', value: totalOperations, color: '#10b981' },
      { name: 'Admin & Other', value: totalAdmin + totalOtherExpenses, color: '#8b5cf6' }
    ].filter(item => item.value > 0);

    return {
      totalRevenue,
      totalCOGS,
      totalOPEX,
      totalExpenses,
      grossProfit,
      grossMarginPercent,
      netProfit,
      estimatedROI,
      cashIn, cashOut, cashNet: cashIn - cashOut,
      onepayIn, onepayOut, onepayNet: onepayIn - onepayOut,
      ldbIn, ldbOut, ldbNet: ldbIn - ldbOut,
      categoryChartData,
      activePeriodName: timeframeMode === 'all' ? 'All-Time' : format(targetDate, 'MMMM yyyy')
    };
  }, [transactions, supplierPrices, timeframeMode, selectedMonthStr]);

  // ================= 💡 2. EXECUTIVE AI INSIGHTS & AUDIT ADVISORY =================
  const smartInsights = useMemo(() => {
    const list: Array<{ titleLa: string; titleEn: string; descLa: string; descEn: string; type: 'success' | 'warning' | 'info' }> = [];
    const { totalRevenue, totalCOGS, grossMarginPercent, netProfit, estimatedROI } = financialData;

    // 1. Gross Margin Analysis
    if (totalRevenue > 0) {
      if (grossMarginPercent >= 55) {
        list.push({
          titleLa: 'ອັດຕາກຳໄລຂັ້ນຕົ້ນດີເລີດ (High Margin)',
          titleEn: 'Exceptional Gross Margin',
          descLa: `Gross Margin ສູງເຖິງ ${grossMarginPercent.toFixed(1)}% ສະແດງວ່າສູດ ແລະ ລາຄາຂາຍກຳນົດໄດ້ດີຫຼາຍ!`,
          descEn: `Gross Margin is at ${grossMarginPercent.toFixed(1)}%, indicating strong recipe pricing efficiency.`,
          type: 'success'
        });
      } else if (grossMarginPercent < 40) {
        list.push({
          titleLa: 'ຕົ້ນທຶນວັດຖຸດິບສູງເກີນເກນ (High COGS)',
          titleEn: 'COGS Pressure Alert',
          descLa: `Gross Margin ຕ່ຳກວ່າ 40% (${grossMarginPercent.toFixed(1)}%). ຄວນຕໍ່ລອງລາຄາວັດຖຸດິບກັບ Supplier ຫຼື ປັບຂະໜາດ Portions.`,
          descEn: `Gross Margin below 40% (${grossMarginPercent.toFixed(1)}%). Negotiate bulk prices or refine recipe portions.`,
          type: 'warning'
        });
      }
    }

    // 2. Net Profit & ROI Analysis
    if (netProfit > 0) {
      list.push({
        titleLa: `ທຸລະກິດສ້າງກຳໄລສຸດທິ ${Math.round(netProfit).toLocaleString()} ₭`,
        titleEn: `Net Positive Return of ${Math.round(netProfit).toLocaleString()} ₭`,
        descLa: `ຜົນຕອບແທນ ROI ຢູ່ທີ່ ${estimatedROI.toFixed(1)}%. ທຸລະກິດມີສະພາບຄ່ອງແຂງແກ່ນ.`,
        descEn: `Estimated ROI is ${estimatedROI.toFixed(1)}%, confirming strong operational liquidity.`,
        type: 'success'
      });
    } else if (netProfit < 0) {
      list.push({
        titleLa: 'ແຈ້ງເຕືອນລາຍຈ່າຍເກີນລາຍຮັບ (Deficit)',
        titleEn: 'Operating Deficit Warning',
        descLa: `ລາຍຈ່າຍລວມເກີນລາຍຮັບ ${Math.abs(Math.round(netProfit)).toLocaleString()} ₭. ຄວນຕັດລາຍຈ່າຍທີ່ບໍ່ຈຳເປັນ.`,
        descEn: `Expenses exceed inflows by ${Math.abs(Math.round(netProfit)).toLocaleString()} ₭. Reduce non-essential OPEX.`,
        type: 'warning'
      });
    }

    // 3. COGS Ratio
    const cogsRatio = totalRevenue > 0 ? (totalCOGS / totalRevenue) * 100 : 0;
    list.push({
      titleLa: `ອັດຕາສ່ວນ COGS ຕໍ່ຍອດຂາຍ: ${cogsRatio.toFixed(1)}%`,
      titleEn: `COGS-to-Revenue Ratio: ${cogsRatio.toFixed(1)}%`,
      descLa: `ມາດຕະຖານຮ້ານອາຫານ/ຄາເຟແມ່ນ 30% - 35%. ປັດຈຸບັນໃຊ້ຕົ້ນທຶນວັດຖຸດິບ ${Math.round(totalCOGS).toLocaleString()} ₭.`,
      descEn: `Industry standard benchmark is 30% - 35%. Current material costs: ${Math.round(totalCOGS).toLocaleString()} ₭.`,
      type: cogsRatio <= 35 ? 'success' : 'info'
    });

    return list;
  }, [financialData]);

  // Export to Excel
  const handleExportExcel = () => {
    const headers = ['Financial Metric', 'Amount (LAK)', 'Notes'];
    const rows = [
      ['Total Revenue (ຍອດຂາຍລວມ)', financialData.totalRevenue, 'Inflow from Sales'],
      ['COGS (ຕົ້ນທຶນວັດຖຸດິບ)', financialData.totalCOGS, 'Material Purchases (Purchasing)'],
      ['Gross Profit (ກຳໄລຂັ້ນຕົ້ນ)', financialData.grossProfit, 'Revenue - COGS'],
      ['Gross Margin %', `${financialData.grossMarginPercent.toFixed(2)}%`, 'Margin Percentage'],
      ['Operating Expenses (OPEX)', financialData.totalOPEX, 'Salary, Rent, Utilities, Admin'],
      ['Net Profit (ກຳໄລສຸດທິ)', financialData.netProfit, 'Revenue - All Costs'],
      ['Estimated ROI %', `${financialData.estimatedROI.toFixed(2)}%`, 'Return on Total Investment'],
      ['Cash Balance (ເງິນສົດ)', financialData.cashNet, 'Physical Cash in Hand'],
      ['OnePay Balance (BCEL)', financialData.onepayNet, 'Digital Transfers'],
      ['LDB Balance (ທະນາຄານ)', financialData.ldbNet, 'Bank Account']
    ];

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Executive Financial Report');
    writeFile(workbook, `Financial_Report_${financialData.activePeriodName.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div className="space-y-6">

      {/* ================= 1. HEADER & TIMEFRAME SELECTOR ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <PieChart className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {i18n.language === 'la' ? 'ບົດລາຍງານການເງິນ & ວິເຄາະທຸລະກິດ (Finance Report)' : 'Financial Performance & Insights'}
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {(selectedBranch || 'branch_1') === 'branch_1' ? (i18n.language === 'la' ? 'ສາຂາ 1' : 'Branch 1') : (i18n.language === 'la' ? 'ສາຂາ 2' : 'Branch 2')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {i18n.language === 'la' ? `ຮອບໄລຍະເວລາ: ${financialData.activePeriodName}` : `Active Period: ${financialData.activePeriodName}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Month Selector */}
          <input
            type="month"
            value={selectedMonthStr}
            onChange={e => {
              setSelectedMonthStr(e.target.value);
              setTimeframeMode('month');
            }}
            className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
          />

          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200/80 dark:border-white/10">
            <button
              type="button"
              onClick={() => setTimeframeMode('month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
                timeframeMode === 'month' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500'
              }`}
            >
              {i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'}
            </button>
            <button
              type="button"
              onClick={() => setTimeframeMode('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
                timeframeMode === 'all' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500'
              }`}
            >
              {i18n.language === 'la' ? 'ທັງໝົດ' : 'All-Time'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* ================= 2. 🌟 5 CORE FINANCIAL KPIS (REVENUE, COGS, MARGIN, NET PROFIT, ROI) ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-
