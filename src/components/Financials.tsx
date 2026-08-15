import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart as RePie, Pie, Cell, Legend
} from 'recharts';
import { 
  PieChart, ArrowUpRight, ArrowDownRight, Sparkles, Download, 
  Wallet, CreditCard, Building2, Percent, Loader2, Calendar, Filter
} from 'lucide-react';
import { format, isSameMonth, subMonths } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

export default function FinanceReport({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');
  const [selectedMonthStr, setSelectedMonthStr] = useState<string>(format(new Date(), 'yyyy-MM'));

  // 🛡️ ຟັງຊັນແປງວັນທີແບບປອດໄພ 100% (ບໍ່ມີ Error ຄ້າງ)
  const safeParseDate = (d: any): Date | null => {
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
            if (p2 > 1000) return new Date(p2, p1 - 1, p0); // DD/MM/YYYY
            if (p0 > 1000) return new Date(p0, p1 - 1, p2); // YYYY/MM/DD
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

  // Subscribe to real-time collections
  useEffect(() => {
    const branch = selectedBranch || 'branch_1';
    let isMounted = true;

    const unsubTx = onSnapshot(query(collection(db, 'transactions'), orderBy('date', 'desc')), (snap) => {
      if (!isMounted) return;
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === branch));
      setLoading(false);
    }, () => setLoading(false));

    const unsubSuppliers = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      if (!isMounted) return;
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

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
      const parsed = safeParseDate(dateInput);
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
      cashNet: cashIn - cashOut,
      onepayNet: onepayIn - onepayOut,
      ldbNet: ldbIn - ldbOut,
      categoryChartData,
      activePeriodName: timeframeMode === 'all' ? 'All-Time' : format(targetDate, 'MMMM yyyy')
    };
  }, [transactions, supplierPrices, timeframeMode, selectedMonthStr]);

  const smartInsights = useMemo(() => {
    const list: Array<{ titleLa: string; descLa: string; type: 'success' | 'warning' | 'info' }> = [];
    const { totalRevenue, totalCOGS, grossMarginPercent, netProfit, estimatedROI } = financialData;

    if (totalRevenue > 0) {
      if (grossMarginPercent >= 55) {
        list.push({
          titleLa: 'ອັດຕາກຳໄລຂັ້ນຕົ້ນດີເລີດ (High Margin)',
          descLa: `Gross Margin ສູງເຖິງ ${grossMarginPercent.toFixed(1)}% ສ້າງກຳໄລສຸດທິ ${Math.round(netProfit).toLocaleString()} ₭.`,
          type: 'success'
        });
      } else if (grossMarginPercent < 40) {
        list.push({
          titleLa: 'ຕົ້ນທຶນວັດຖຸດິບສູງເກີນເກນ (High COGS)',
          descLa: `Gross Margin ຕ່ຳກວ່າ 40% (${grossMarginPercent.toFixed(1)}%). ຄວນຕໍ່ລອງລາຄາວັດຖຸດິບກັບ Supplier.`,
          type: 'warning'
        });
      }
    }

    if (netProfit > 0) {
      list.push({
        titleLa: `ກຳໄລສຸດທິ ${Math.round(netProfit).toLocaleString()} ₭`,
        descLa: `ຜົນຕອບແທນ ROI ຢູ່ທີ່ ${estimatedROI.toFixed(1)}%. ສະພາບຄ່ອງທຸລະກິດດີຫຼາຍ.`,
        type: 'success'
      });
    }

    const cogsRatio = totalRevenue > 0 ? (totalCOGS / totalRevenue) * 100 : 0;
    list.push({
      titleLa: `ອັດຕາສ່ວນ COGS ຕໍ່ຍອດຂາຍ: ${cogsRatio.toFixed(1)}%`,
      descLa: `ມາດຕະຖານແມ່ນ 30% - 35%. ປັດຈຸບັນໃຊ້ຕົ້ນທຶນ ${Math.round(totalCOGS).toLocaleString()} ₭.`,
      type: cogsRatio <= 35 ? 'success' : 'info'
    });

    return list;
  }, [financialData]);

  const handleExportExcel = () => {
    const headers = ['Metric', 'Amount (LAK)', 'Notes'];
    const rows = [
      ['Total Revenue', financialData.totalRevenue, 'Inflows'],
      ['COGS (Purchasing)', financialData.totalCOGS, 'Material Cost'],
      ['Gross Profit', financialData.grossProfit, 'Revenue - COGS'],
      ['Gross Margin %', `${financialData.grossMarginPercent.toFixed(2)}%`, 'Margin Ratio'],
      ['OPEX', financialData.totalOPEX, 'Operating Costs'],
      ['Net Profit', financialData.netProfit, 'Bottom Line Profit'],
      ['Estimated ROI %', `${financialData.estimatedROI.toFixed(2)}%`, 'Return on Costs']
    ];

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Finance Report');
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
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* 5 Core Financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/70 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
            COGS (Purchasing)
          </span>
          <p className="text-2xl font-black font-mono text-red-500 dark:text-red-400">
            {Math.round(financialData.totalCOGS).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">Material Costs</p>
        </div>

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

      {/* Chart & Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Cost Structure Pie */}
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

          <div className="h-[240px] w-full min-h-[240px] flex items-center justify-center">
            {financialData.categoryChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <RePie>
                  <Pie
                    data={financialData.categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {financialData.categoryChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number) => [`${val.toLocaleString()} ₭`, '']} />
                  <Legend />
                </RePie>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400 uppercase font-bold">No records found for this period</p>
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
              {smartInsights.map((insight, idx) => (
                <div
                  key={idx}
                  className={`p-3.5 rounded-2xl border space-y-1 ${
                    insight.type === 'warning' ? 'bg-amber-500/5 border-amber-500/20 text-amber-900 dark:text-amber-300' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-900 dark:text-emerald-300'
                  }`}
                >
                  <h4 className="text-[11px] font-black uppercase tracking-tight">{insight.titleLa}</h4>
                  <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{insight.descLa}</p>
                </div>
              ))}
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
