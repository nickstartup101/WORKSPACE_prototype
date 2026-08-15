import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { 
  PieChart, ArrowUpRight, ArrowDownRight, Sparkles, Download, 
  Wallet, CreditCard, Building2, Percent, Loader2, Calendar, 
  Filter, DollarSign, TrendingUp, ShoppingCart, Tag, CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { format, isSameMonth, parseISO } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

export default function FinanceReport({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');
  const [selectedMonthStr, setSelectedMonthStr] = useState<string>(format(new Date(), 'yyyy-MM'));

  // 🛡️ ຟັງຊັນແປງວັນທີແບບປອດໄພ
  const parseSafeDate = (d: any): Date | null => {
    if (!d) return null;
    try {
      if (d instanceof Date && !isNaN(d.getTime())) return d;
      if (typeof d?.toDate === 'function') return d.toDate();
      if (typeof d === 'string') {
        const clean = d.trim().split(' ')[0];
        if (clean.includes('/')) {
          const parts = clean.split('/');
          if (parts.length === 3) {
            const p0 = parseInt(parts[0], 10);
            const p1 = parseInt(parts[1], 10);
            const p2 = parseInt(parts[2], 10);
            if (p2 > 1000) return new Date(p2, p1 - 1, p0);
            if (p0 > 1000) return new Date(p0, p1 - 1, p2);
          }
        }
        const parsed = new Date(clean);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
    } catch {
      return null;
    }
    return null;
  };

  // Subscribe Real-time
  useEffect(() => {
    const branch = selectedBranch || 'branch_1';
    let isMounted = true;

    const unsubTx = onSnapshot(collection(db, 'transactions'), (snap) => {
      if (!isMounted) return;
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === branch));
      setLoading(false);
    }, () => setLoading(false));

    const unsubSuppliers = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      if (!isMounted) return;
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return () => {
      isMounted = false;
      unsubTx();
      unsubSuppliers();
    };
  }, [selectedBranch]);

  const normalizePayment = (src?: string): 'Cash' | 'Onepay' | 'LDB' => {
    if (!src) return 'Cash';
    const s = String(src).toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // ================= 📊 1. DYNAMIC FINANCIAL CALCULATION =================
  const financialData = useMemo(() => {
    const now = new Date();
    let targetDate = now;
    try {
      const p = new Date(`${selectedMonthStr}-01`);
      if (!isNaN(p.getTime())) targetDate = p;
    } catch {
      targetDate = now;
    }

    const filterByTimeframe = (dateInput?: any) => {
      if (timeframeMode === 'all') return true;
      const parsed = parseSafeDate(dateInput);
      if (!parsed) return false;
      try {
        return isSameMonth(parsed, targetDate);
      } catch {
        return false;
      }
    };

    const activeTransactions = transactions.filter(tx => filterByTimeframe(tx.date));

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

    // 1. Process active transactions
    activeTransactions.forEach(tx => {
      const amt = Number(tx.amount) || 0;
      const ch = normalizePayment(tx.source);
      const isIncome = tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales';

      if (isIncome) {
        totalRevenue += amt;
        if (ch === 'Cash') cashIn += amt;
        else if (ch === 'Onepay') onepayIn += amt;
        else if (ch === 'LDB') ldbIn += amt;
      } else {
        const cat = String(tx.category || '').toLowerCase();
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

    // 2. Extract unimported supplierPrices (legacy purchasing)
    supplierPrices.forEach(sp => {
      if (!sp.date || importedSupplierPriceIds.has(sp.id)) return;
      if (filterByTimeframe(sp.date)) {
        const isNew = sp.totalPriceLAK !== undefined;
        const amt = isNew
          ? Number(sp.totalPriceLAK || 0)
          : (sp.currency === 'LAK' ? Number(sp.priceOriginal || 0) : Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * (Number(sp.quantity) || 1);

        const cat = String(sp.category || 'purchasing').toLowerCase();
        if (cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້') || cat === 'purchasing') {
          totalCOGS += amt;
          const ch = normalizePayment(sp.paymentMethod);
          if (ch === 'Cash') cashOut += amt;
          else if (ch === 'Onepay') onepayOut += amt;
          else if (ch === 'LDB') ldbOut += amt;
        }
      }
    });

    const totalOPEX = totalSalary + totalRent + totalOperations + totalAdmin + totalOtherExpenses;
    const totalExpenses = totalCOGS + totalOPEX;
    const grossProfit = totalRevenue - totalCOGS;
    const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netProfit = totalRevenue - totalExpenses;
    const estimatedROI = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

    const breakdownList = [
      { name: 'COGS (ຕົ້ນທຶນວັດຖຸດິບ)', amount: totalCOGS, color: 'bg-rose-500', barColor: '#ef4444' },
      { name: 'Salary (ເງິນເດືອນພະນັກງານ)', amount: totalSalary, color: 'bg-amber-500', barColor: '#f59e0b' },
      { name: 'Rental (ຄ່າເຊົ່າສະຖານທີ່)', amount: totalRent, color: 'bg-blue-500', barColor: '#3b82f6' },
      { name: 'Operations (ຄ່າດຳເນີນງານ/ໄຟ/ນ້ຳ)', amount: totalOperations, color: 'bg-emerald-500', barColor: '#10b981' },
      { name: 'Admin & Others (ບໍລິຫານ/ອື່ນໆ)', amount: totalAdmin + totalOtherExpenses, color: 'bg-purple-500', barColor: '#a855f7' }
    ].filter(item => item.amount > 0);

    return {
      totalRevenue,
      totalCOGS,
      totalOPEX,
      totalExpenses,
      grossProfit,
      grossMarginPercent,
      netProfit,
      estimatedROI,
      cashNet: cashIn - cashOut,
      onepayNet: onepayIn - onepayOut,
      ldbNet: ldbIn - ldbOut,
      breakdownList,
      activePeriodName: timeframeMode === 'all' ? 'All-Time' : format(targetDate, 'MMMM yyyy')
    };
  }, [transactions, supplierPrices, timeframeMode, selectedMonthStr]);

  const handleExportExcel = () => {
    const headers = ['Financial Metric', 'Amount (LAK)', 'Notes'];
    const rows = [
      ['Total Revenue (ຍອດຂາຍລວມ)', financialData.totalRevenue, 'Inflows'],
      ['COGS (ຕົ້ນທຶນວັດຖຸດິບ)', financialData.totalCOGS, 'Material Costs'],
      ['Gross Profit (ກຳໄລຂັ້ນຕົ້ນ)', financialData.grossProfit, 'Revenue - COGS'],
      ['Gross Margin %', `${financialData.grossMarginPercent.toFixed(2)}%`, 'Margin Ratio'],
      ['OPEX (ຄ່າໃຊ້ຈ່າຍດຳເນີນງານ)', financialData.totalOPEX, 'Salary, Rent, Utilities, Admin'],
      ['Net Profit (ກຳໄລສຸດທິ)', financialData.netProfit, 'Bottom Line Profit'],
      ['Estimated ROI %', `${financialData.estimatedROI.toFixed(2)}%`, 'Return on Costs'],
      ['Cash Balance', financialData.cashNet, 'Cash in Hand'],
      ['OnePay Balance', financialData.onepayNet, 'BCEL OnePay'],
      ['LDB Balance', financialData.ldbNet, 'LDB Bank']
    ];

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Financial Report');
    writeFile(workbook, `Finance_Report_${financialData.activePeriodName.replace(/\s+/g, '_')}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-xs text-slate-400 font-bold uppercase mt-3 tracking-widest">Loading Financial Report...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <PieChart className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {i18n.language === 'la' ? 'ບົດລາຍງານການເງິນ & ວິເຄາະທຸລະກິດ' : 'Financial Performance & Insights'}
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {(selectedBranch || 'branch_1') === 'branch_1' ? (i18n.language === 'la' ? 'ສາຂາ 1' : 'Branch 1') : (i18n.language === 'la' ? 'ສາຂາ 2' : 'Branch 2')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {financialData.activePeriodName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={selectedMonthStr}
            onChange={e => {
              setSelectedMonthStr(e.target.value);
              setTimeframeMode('month');
            }}
            className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white outline-none cursor-pointer"
          />

          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200/80 dark:border-white/10">
            <button
              type="button"
              onClick={() => setTimeframeMode('month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                timeframeMode === 'month' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500'
              }`}
            >
              {i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'}
            </button>
            <button
              type="button"
              onClick={() => setTimeframeMode('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
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

      {/* 5 Core Financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* 1. Revenue */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
            Total Revenue
          </span>
          <p className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(financialData.totalRevenue).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">Customer Inflows</p>
        </div>

        {/* 2. COGS (Material Purchasing) */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
            COGS (Purchasing)
          </span>
          <p className="text-2xl font-black font-mono text-rose-500 dark:text-rose-400">
            {Math.round(financialData.totalCOGS).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">Material Costs</p>
        </div>

        {/* 3. Gross Margin */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <Percent className="w-3.5 h-3.5 text-blue-500" />
            Gross Margin
          </span>
          <p className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400">
            {financialData.grossMarginPercent.toFixed(1)}%
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">
            GP: {Math.round(financialData.grossProfit).toLocaleString()} ₭
          </p>
        </div>

        {/* 4. Net Profit */}
        <div className={`p-5 rounded-3xl border space-y-1 ${
          financialData.netProfit >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400'
        }`}>
          <span className="text-[10px] font-black uppercase block">Net Profit</span>
          <p className="text-2xl font-black font-mono">
            {Math.round(financialData.netProfit).toLocaleString()} ₭
          </p>
          <p className="text-[9px] opacity-80 font-bold uppercase">
            OPEX: {Math.round(financialData.totalOPEX).toLocaleString()} ₭
          </p>
        </div>

        {/* 5. Estimated ROI */}
        <div className="bg-amber-500/10 border border-amber-500/20 p-5 rounded-3xl text-amber-700 dark:text-amber-400 space-y-1">
          <span className="text-[10px] font-black uppercase block">Estimated ROI</span>
          <p className="text-2xl font-black font-mono">
            {financialData.estimatedROI.toFixed(1)}%
          </p>
          <p className="text-[9px] opacity-80 font-bold uppercase">Return on Total Cost</p>
        </div>

      </div>

      {/* 3 Channels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-black uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-4 h-4" />
              <span>ເງິນສົດ (Cash)</span>
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 rounded font-bold">Cash</span>
          </div>
          <p className="text-2xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialData.cashNet).toLocaleString()} ₭
          </p>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-black uppercase text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <CreditCard className="w-4 h-4" />
              <span>BCEL OnePay</span>
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-red-500/10 text-red-500 rounded font-bold">OnePay</span>
          </div>
          <p className="text-2xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialData.onepayNet).toLocaleString()} ₭
          </p>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-black uppercase text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Building2 className="w-4 h-4" />
              <span>ທະນາຄານ LDB</span>
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded font-bold">LDB</span>
          </div>
          <p className="text-2xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialData.ldbNet).toLocaleString()} ₭
          </p>
        </div>
      </div>

      {/* High-Performance Cost Distribution & Strategic Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Cost Structure Breakdown Bars */}
        <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-6 rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" />
              <span>ໂຄງສ້າງຕົ້ນທຶນ & ລາຍຈ່າຍ (Cost Breakdown)</span>
            </h3>
            <span className="text-[10px] font-mono font-bold text-slate-400">
              Total: {Math.round(financialData.totalExpenses).toLocaleString()} ₭
            </span>
          </div>

          <div className="space-y-3.5 pt-1">
            {financialData.breakdownList.length > 0 ? (
              financialData.breakdownList.map((item, idx) => {
                const pct = financialData.totalExpenses > 0 ? (item.amount / financialData.totalExpenses) * 100 : 0;

                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-slate-700 dark:text-slate-200">{item.name}</span>
                      <span className="font-mono text-slate-900 dark:text-white">
                        {Math.round(item.amount).toLocaleString()} ₭ ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 dark:bg-black/20 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${item.color} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-400 uppercase font-bold py-6 text-center">No expense records found for this period</p>
            )}
          </div>
        </div>

        {/* Strategic Insights */}
        <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-6 rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3 mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
                <span>ບົດວິເຄາະ & Insights ຜູ້ບໍລິຫານ</span>
              </h3>
              <span className="text-[8.5px] font-black uppercase px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                AI Strategic
              </span>
            </div>

            <div className="space-y-3">
              {/* Insight 1 */}
              <div className="p-3.5 rounded-2xl border bg-emerald-500/5 border-emerald-500/20 text-emerald-900 dark:text-emerald-300 space-y-1">
                <h4 className="text-[11px] font-black uppercase tracking-tight flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>ອັດຕາກຳໄລຂັ້ນຕົ້ນ: {financialData.grossMarginPercent.toFixed(1)}%</span>
                </h4>
                <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium pl-3">
                  ຍອດຂາຍລວມ {Math.round(financialData.totalRevenue).toLocaleString()} ₭ ຫັກຕົ້ນທຶນວັດຖຸດິບ {Math.round(financialData.totalCOGS).toLocaleString()} ₭ ເຫຼືອກຳໄລຂັ້ນຕົ້ນ {Math.round(financialData.grossProfit).toLocaleString()} ₭.
                </p>
              </div>

              {/* Insight 2 */}
              <div className="p-3.5 rounded-2xl border bg-blue-500/5 border-blue-500/20 text-blue-900 dark:text-blue-300 space-y-1">
                <h4 className="text-[11px] font-black uppercase tracking-tight flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  <span>ຜົນຕອບແທນການລົງທຶນ (Estimated ROI): {financialData.estimatedROI.toFixed(1)}%</span>
                </h4>
                <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium pl-3">
                  ກຳໄລສຸດທິຫຼັງຫັກຄ່າໃຊ້ຈ່າຍທັງໝົດແມ່ນ {Math.round(financialData.netProfit).toLocaleString()} ₭.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-white/10 text-[10px] text-slate-400 font-bold">
            Realtime Audit Engine Connected
          </div>
        </div>

      </div>

    </div>
  );
}
