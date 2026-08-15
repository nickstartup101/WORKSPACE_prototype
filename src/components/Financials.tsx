import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, setDoc, getDoc, getDocs, serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { format, isSameMonth, parseISO, subDays } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { 
  Upload, Receipt, PlusCircle, ArrowUpCircle, ArrowDownCircle, 
  Info, Landmark, Download, BarChart3, Eye, EyeOff, X, Trash2, 
  RefreshCw, Sparkles, CheckCircle, FileText, Wallet, CreditCard,
  Building2, TrendingUp, DollarSign, Calendar, Filter, PieChart,
  Percent, ArrowUpRight, ArrowDownRight, Edit3, Check, Split
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import ApprovalModal from './ApprovalModal';
import PinModal from './PinModal';

export type PaymentChannel = 'Cash' | 'Onepay' | 'LDB';

export default function Financials({ appConfig, selectedBranch }: { appConfig: any, selectedBranch?: string }) {
  const { t, i18n } = useTranslation();
  
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [dailyTransactions, setDailyTransactions] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any>(null);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Timeframe View Mode: 'month' vs 'all'
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');

  // Date View State
  const [viewDate, setViewDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Bank Modal States
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankAmount, setBankAmount] = useState(0);
  const [bankChannel, setBankChannel] = useState<PaymentChannel>('Onepay');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'transaction' | 'bank' | null>(null);
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Form State
  const [formData, setFormData] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: 0,
    category: 'Purchasing',
    description: '',
    source: 'Cash' as PaymentChannel,
    receipt: null as File | null,
    date: format(new Date(), 'yyyy-MM-dd'),
    time: format(new Date(), 'HH:mm')
  });

  const [displayAmount, setDisplayAmount] = useState('');

  // 🌟 3-WAY SPLIT INCOME STATES (Cash, Onepay, LDB)
  const [is3WaySplit, setIs3WaySplit] = useState(true); // Default to true for Income
  const [splitCash, setSplitCash] = useState<number>(0);
  const [splitCashDisplay, setSplitCashDisplay] = useState<string>('');
  const [splitOnepay, setSplitOnepay] = useState<number>(0);
  const [splitOnepayDisplay, setSplitOnepayDisplay] = useState<string>('');
  const [splitLDB, setSplitLDB] = useState<number>(0);
  const [splitLDBDisplay, setSplitLDBDisplay] = useState<string>('');

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [oldTxData, setOldTxData] = useState<any>(null);
  const [deleteReceipt, setDeleteReceipt] = useState(false);
  const [showEditPinModal, setShowEditPinModal] = useState(false);
  const [txToEdit, setTxToEdit] = useState<any>(null);

  const [txToDelete, setTxToDelete] = useState<any>(null);
  const [showDeletePinModal, setShowDeletePinModal] = useState(false);

  // Supplier Prices Integration
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [pullDate, setPullDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [billPaymentSources, setBillPaymentSources] = useState<{ [id: string]: PaymentChannel }>({});
  const [importingBillId, setImportingBillId] = useState<string | null>(null);

  const normalizePaymentChannel = (src?: string): PaymentChannel => {
    if (!src) return 'Cash';
    const s = src.toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  const formatWithCommas = (val: string | number) => {
    const clean = String(val).replace(/,/g, '');
    if (!clean || isNaN(Number(clean))) return '';
    return Number(clean).toLocaleString();
  };

  // 🌟 SMART AUTO-BALANCE CALCULATION
  const handleTotalAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/,/g, '');
    if (rawValue === '' || !isNaN(Number(rawValue))) {
      const num = Number(rawValue) || 0;
      setDisplayAmount(formatWithCommas(rawValue));
      setFormData(prev => ({ ...prev, amount: num }));

      if (formData.type === 'income' && is3WaySplit) {
        // Auto-assign remaining balance to LDB or Cash
        const remaining = Math.max(0, num - splitCash - splitOnepay);
        setSplitLDB(remaining);
        setSplitLDBDisplay(remaining > 0 ? formatWithCommas(remaining) : '');
      }
    }
  };

  const handleSplitCashChange = (valStr: string) => {
    const clean = valStr.replace(/,/g, '');
    if (clean === '' || !isNaN(Number(clean))) {
      const val = Number(clean) || 0;
      setSplitCash(val);
      setSplitCashDisplay(formatWithCommas(clean));

      // Auto balance LDB: Total - Cash - OnePay
      const total = formData.amount || (val + splitOnepay + splitLDB);
      const remaining = Math.max(0, total - val - splitOnepay);
      setSplitLDB(remaining);
      setSplitLDBDisplay(remaining > 0 ? formatWithCommas(remaining) : '');
    }
  };

  const handleSplitOnepayChange = (valStr: string) => {
    const clean = valStr.replace(/,/g, '');
    if (clean === '' || !isNaN(Number(clean))) {
      const val = Number(clean) || 0;
      setSplitOnepay(val);
      setSplitOnepayDisplay(formatWithCommas(clean));

      // Auto balance LDB: Total - Cash - OnePay
      const total = formData.amount || (splitCash + val + splitLDB);
      const remaining = Math.max(0, total - splitCash - val);
      setSplitLDB(remaining);
      setSplitLDBDisplay(remaining > 0 ? formatWithCommas(remaining) : '');
    }
  };

  const handleSplitLDBChange = (valStr: string) => {
    const clean = valStr.replace(/,/g, '');
    if (clean === '' || !isNaN(Number(clean))) {
      const val = Number(clean) || 0;
      setSplitLDB(val);
      setSplitLDBDisplay(formatWithCommas(clean));

      // Update total to sum if total was smaller
      const sum = splitCash + splitOnepay + val;
      if (sum > formData.amount) {
        setFormData(prev => ({ ...prev, amount: sum }));
        setDisplayAmount(formatWithCommas(sum));
      }
    }
  };

  // Listen to Firestore transactions
  useEffect(() => {
    const qAll = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    const branchId = selectedBranch || 'branch_1';

    const unsubscribeAll = onSnapshot(qAll, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const branchFiltered = all.filter((tx: any) => (tx.branchId || 'branch_1') === branchId);
      setAllTransactions(branchFiltered);

      const daily = branchFiltered.filter((tx: any) => tx.date === viewDate);
      daily.sort((a: any, b: any) => (b.time || '').localeCompare(a.time || ''));
      setDailyTransactions(daily);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => unsubscribeAll();
  }, [viewDate, selectedBranch]);

  // Load products and supplierPrices
  useEffect(() => {
    const unsubPrices = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unsubPrices();
      unsubProducts();
    };
  }, []);

  // Sync pullDate and paymentDate
  useEffect(() => {
    setPullDate(viewDate);
    setPaymentDate(viewDate);
  }, [viewDate]);

  // ================= 📊 FINANCIAL KPIS & PAYMENT CHANNEL CALCULATION =================
  const financialSummary = useMemo(() => {
    const now = new Date();

    const activeList = allTransactions.filter(tx => {
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

    activeList.forEach(tx => {
      const amt = Number(tx.amount) || 0;
      const ch = normalizePaymentChannel(tx.source);
      const isIncome = tx.type === 'income' || tx.category?.toLowerCase() === 'sales';

      if (isIncome) {
        totalRevenue += amt;
        if (ch === 'Cash') cashIncome += amt;
        else if (ch === 'Onepay') onepayIncome += amt;
        else if (ch === 'LDB') ldbIncome += amt;
      } else {
        const cat = (tx.category || '').toLowerCase();
        const isPurchasing = cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້');

        if (isPurchasing) totalPurchasing += amt;
        else totalOPEX += amt;

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
      totalNetLiquidity
    };
  }, [allTransactions, timeframeMode]);

  // Upload image to Firebase Storage
  const handleUpload = async (file: File, uploadDate: string) => {
    if (!file.type.startsWith('image/')) {
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      return await getDownloadURL(fileRef);
    }
    try {
      const compressedFile = await imageCompression(file, { maxSizeMB: 0.3, maxWidthOrHeight: 1200 });
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${compressedFile.name}`);
      await uploadBytes(fileRef, compressedFile);
      return await getDownloadURL(fileRef);
    } catch {
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      return await getDownloadURL(fileRef);
    }
  };

  // 🌟 SUBMIT TRANSACTION (WITH 3-WAY SPLIT SUPPORT)
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      let receiptUrl = '';
      if (formData.receipt && typeof formData.receipt !== 'string') {
        receiptUrl = await handleUpload(formData.receipt, formData.date);
      } else if (isEditing && !deleteReceipt) {
        receiptUrl = oldTxData?.receiptUrl || '';
      }

      const branchId = selectedBranch || 'branch_1';
      const batchGroupId = `split_${Date.now()}`;

      // 🌟 IF INCOME AND 3-WAY SPLIT IS ACTIVE
      if (formData.type === 'income' && is3WaySplit && !isEditing) {
        const entries: Array<{ amount: number; source: PaymentChannel; label: string }> = [
          { amount: splitCash, source: 'Cash', label: 'ສ່ວນເງິນສົດ (Cash)' },
          { amount: splitOnepay, source: 'Onepay', label: 'ສ່ວນ BCEL OnePay' },
          { amount: splitLDB, source: 'LDB', label: 'ສ່ວນ ທະນາຄານ LDB' }
        ];

        let savedCount = 0;
        for (const item of entries) {
          if (item.amount > 0) {
            await addDoc(collection(db, 'transactions'), {
              type: 'income',
              amount: item.amount,
              category: formData.category || 'Sales',
              description: formData.description ? `${formData.description} • ${item.label}` : item.label,
              source: item.source,
              receiptUrl,
              date: formData.date,
              time: formData.time,
              batchGroupId,
              updatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              userId: auth.currentUser?.uid || 'admin',
              userEmail: auth.currentUser?.email || 'admin@example.com',
              branchId
            });
            savedCount++;
          }
        }

        alert(i18n.language === 'la' 
          ? `ບັນທຶກລາຍຮັບແຍກ ${savedCount} ຊ່ອງທາງ (${formData.amount.toLocaleString()} ₭) ສຳເລັດແລ້ວ!` 
          : `Saved ${savedCount} split income channels successfully!`);
      } else {
        // STANDARD SINGLE ENTRY (OR EXPENSE)
        const txData = {
          type: formData.type,
          amount: formData.amount,
          category: formData.category,
          description: formData.description,
          source: formData.source,
          receiptUrl,
          date: formData.date,
          time: formData.time,
          updatedAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
          branchId,
          ...(isEditing && oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
          ...(isEditing && oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {})
        };

        if (isEditing && editingId) {
          await setDoc(doc(db, 'transactions', editingId), txData, { merge: true });
          alert(i18n.language === 'la' ? 'ແກ້ໄຂລາຍການສຳເລັດແລ້ວ!' : 'Transaction updated!');
        } else {
          await addDoc(collection(db, 'transactions'), {
            ...txData,
            createdAt: serverTimestamp()
          });
          alert(i18n.language === 'la' ? 'ບັນທຶກລາຍການສຳເລັດແລ້ວ!' : 'Transaction saved!');
        }
      }

      // Reset Form
      setFormData({
        type: 'income',
        amount: 0,
        category: 'Sales',
        description: '',
        source: 'Cash',
        receipt: null,
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm')
      });
      setDisplayAmount('');
      setSplitCash(0);
      setSplitCashDisplay('');
      setSplitOnepay(0);
      setSplitOnepayDisplay('');
      setSplitLDB(0);
      setSplitLDBDisplay('');
      setIsEditing(false);
      setEditingId(null);
      setOldTxData(null);
      setDeleteReceipt(false);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (tx: any) => {
    setTxToEdit(tx);
    setShowEditPinModal(true);
  };

  const handleEditConfirmed = () => {
    if (!txToEdit) return;
    setFormData({
      type: txToEdit.type,
      amount: txToEdit.amount,
      category: txToEdit.category || 'Sales',
      description: txToEdit.description || '',
      source: normalizePaymentChannel(txToEdit.source),
      receipt: null,
      date: txToEdit.date,
      time: txToEdit.time || format(new Date(), 'HH:mm')
    });
    setDisplayAmount(txToEdit.amount.toLocaleString());
    setIsEditing(true);
    setEditingId(txToEdit.id);
    setOldTxData(txToEdit);
    setDeleteReceipt(false);
    setShowEditPinModal(false);
    setTxToEdit(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startDelete = (tx: any) => {
    setTxToDelete(tx);
    setShowDeletePinModal(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!txToDelete) return;
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'transactions', txToDelete.id));
      alert(i18n.language === 'la' ? 'ລຶບລາຍການສຳເລັດແລ້ວ!' : 'Transaction deleted!');
      setShowDeletePinModal(false);
      setTxToDelete(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* ================= 1. TIMEFRAME SELECTOR & TOP BAR ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              {i18n.language === 'la' ? 'ລະບົບການເງິນ & ບັນຊີ (Financials Desk)' : 'Executive Financial Desk'}
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-300 font-bold uppercase mt-0.5">
              {timeframeMode === 'month' 
                ? (i18n.language === 'la' ? `ກຳລັງສະແດງ: ສະເພາະເດືອນນີ້ (${format(new Date(), 'MMMM yyyy')})` : `Viewing: Current Month (${format(new Date(), 'MMMM yyyy')})`)
                : (i18n.language === 'la' ? 'ກຳລັງສະແດງ: ຍອດລວມທັງໝົດ (All-Time Data)' : 'Viewing: All-Time Overall Data')}
            </p>
          </div>
        </div>

        {/* Timeframe Toggle Switch */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
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

          <button 
            onClick={() => setShowPrivacy(!showPrivacy)}
            className="px-3.5 py-2 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase rounded-2xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            {showPrivacy ? <Eye className="w-3.5 h-3.5 text-emerald-500" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{showPrivacy ? "Show" : "Hide"}</span>
          </button>
        </div>
      </div>

      {/* ================= 2. PAYMENT CHANNELS CARDS (Cash, Onepay, LDB) ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Liquidity Net Balance */}
        <div className="bg-gradient-to-br from-[#052659] to-[#073069] text-white p-5 rounded-3xl shadow-xl space-y-2 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#5483B3]">
              {i18n.language === 'la' ? 'ຍອດເງິນຄົງເຫຼືອລວມທັງໝົດ' : 'Total Net Liquidity'}
            </span>
            <div className="p-2 bg-white/10 rounded-xl">
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-black font-mono tracking-tight">
            {showPrivacy ? '••••••••' : `${Math.round(financialSummary.totalNetLiquidity).toLocaleString()} ₭`}
          </p>
          <p className="text-[9px] text-blue-200/60 font-bold uppercase">
            In: +{Math.round(financialSummary.totalRevenue).toLocaleString()} | Out: -{Math.round(financialSummary.totalExpenses).toLocaleString()}
          </p>
        </div>

        {/* Cash In Hand */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດໃນມື (Cash)' : 'Cash Balance'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded">Cash</span>
          </div>
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.cashNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.cashIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.cashExpense).toLocaleString()}</span>
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
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.onepayNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.onepayIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.onepayExpense).toLocaleString()}</span>
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
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.ldbNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.ldbIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.ldbExpense).toLocaleString()}</span>
          </div>
        </div>

      </div>

      {/* ================= 3. TRANSACTION ENTRY FORM (WITH 3-WAY SPLIT) ================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* FORM (5 Cols) */}
        <div className="xl:col-span-5 space-y-6">
          <div className="high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-emerald-500" />
                <span>{isEditing ? 'ແກ້ໄຂລາຍການ (Edit)' : 'ບັນທຶກລາຍການ (Transaction Entry)'}</span>
              </h3>
              {isEditing && (
                <button 
                  onClick={() => {
                    setIsEditing(false);
                    setEditingId(null);
                    setDisplayAmount('');
                  }}
                  className="text-[9px] font-black text-red-500 uppercase"
                >
                  Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleAddTransaction} className="space-y-4">
              
              {/* Type Switcher: Income vs Expense */}
              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl">
                <button 
                  type="button" 
                  onClick={() => setFormData({...formData, type: 'income', category: 'Sales'})}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${formData.type === 'income' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {t('income')} (ລາຍຮັບ)
                </button>
                <button 
                  type="button" 
                  onClick={() => setFormData({...formData, type: 'expense', category: 'Purchasing'})}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${formData.type === 'expense' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {t('expense')} (ລາຍຈ່າຍ)
                </button>
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Date</label>
                  <input 
                    type="date"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Time</label>
                  <input 
                    type="time"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.time}
                    onChange={e => setFormData({...formData, time: e.target.value})}
                  />
                </div>
              </div>

              {/* Total Amount Input */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">
                    {i18n.language === 'la' ? 'ຍອດເງິນທັງໝົດ (Total Amount ₭)' : 'Total Amount (₭)'}
                  </label>
                  {formData.type === 'income' && (
                    <span className="text-[9px] font-black text-emerald-500 flex items-center gap-1 uppercase">
                      <Split className="w-3 h-3" />
                      Auto-Balancing Split Active
                    </span>
                  )}
                </div>
                <input 
                  type="text"
                  required
                  placeholder="0"
                  className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-lg font-mono font-black text-slate-800 dark:text-white"
                  value={displayAmount}
                  onChange={handleTotalAmountChange}
                />
              </div>

              {/* 🌟 3-WAY SPLIT INCOME SECTION (Cash / OnePay / LDB) */}
              {formData.type === 'income' && !isEditing && (
                <div className="p-3.5 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-3 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center border-b border-emerald-500/10 pb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <span>💵📱🏦</span>
                      <span>{i18n.language === 'la' ? 'ແບ່ງ 3 ສ່ວນລາຍຮັບ (Auto-Balance)' : '3-Way Split (Auto-Calculated)'}</span>
                    </span>
                    <span className="text-[9px] font-mono font-bold text-slate-400">
                      Sum: {(splitCash + splitOnepay + splitLDB).toLocaleString()} ₭
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {/* 1. Cash Input */}
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-black uppercase text-emerald-600 dark:text-emerald-400 block truncate">
                        1. ເງິນສົດ (Cash)
                      </label>
                      <input 
                        type="text"
                        placeholder="0"
                        className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border border-emerald-500/20 text-xs font-mono font-bold text-slate-800 dark:text-white"
                        value={splitCashDisplay}
                        onChange={e => handleSplitCashChange(e.target.value)}
                      />
                    </div>

                    {/* 2. OnePay Input */}
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-black uppercase text-red-500 dark:text-red-400 block truncate">
                        2. BCEL OnePay
                      </label>
                      <input 
                        type="text"
                        placeholder="0"
                        className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border border-red-500/20 text-xs font-mono font-bold text-slate-800 dark:text-white"
                        value={splitOnepayDisplay}
                        onChange={e => handleSplitOnepayChange(e.target.value)}
                      />
                    </div>

                    {/* 3. LDB Input (Auto-calculated) */}
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-black uppercase text-blue-500 dark:text-blue-400 block truncate">
                        3. ທະນາຄານ LDB
                      </label>
                      <input 
                        type="text"
                        placeholder="0"
                        className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border border-blue-500/20 text-xs font-mono font-bold text-slate-800 dark:text-white"
                        value={splitLDBDisplay}
                        onChange={e => handleSplitLDBChange(e.target.value)}
                      />
                    </div>
                  </div>
                  
                  <p className="text-[9px] text-slate-400 italic">
                    💡 {i18n.language === 'la' ? 'ໃສ່ຍອດລວມ + ປ້ອນ 2 ຊ່ອງ, ຊ່ອງທີ 3 ຈະຄິດໄລ່ຍອດເຫຼືອໃຫ້ອັດຕະໂນມັດ!' : 'Enter total and 2 channels, 3rd channel auto-balances!'}
                  </p>
                </div>
              )}

              {/* Category & Payment Channel (If Expense or Single Mode) */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Category</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.category}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                    required
                  >
                    {formData.type === 'income' ? (
                      <>
                        <option value="Sales">📈 Sales (ຍອດຂາຍປະຈຳວັນ)</option>
                        <option value="dividends">💰 Dividends (ປັນຜົນ)</option>
                        <option value="other">📦 Other Income (ອື່ນໆ)</option>
                      </>
                    ) : (
                      <>
                        <option value="Purchasing">🛒 Purchasing (ວັດຖຸດິບ)</option>
                        <option value="rent">🏠 Rent (ຄ່າເຊົ່າ)</option>
                        <option value="salary">👥 Salary (ເງິນເດືອນ)</option>
                        <option value="operations">⚙️ Operations (ດຳເນີນງານ)</option>
                        <option value="admin">💼 Admin (ບໍລິຫານ)</option>
                        <option value="electricity">⚡ Electricity (ຄ່າໄຟ)</option>
                        <option value="water">💧 Water (ຄ່ານ້ຳ)</option>
                        <option value="other">📦 Other (ອື່ນໆ)</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Single Channel (Visible when Expense or Editing) */}
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">
                    {formData.type === 'income' && !isEditing ? 'Default Channel' : 'Paid Via'}
                  </label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.source}
                    onChange={e => setFormData({...formData, source: e.target.value as PaymentChannel})}
                  >
                    <option value="Cash">💵 Cash (ເງິນສົດ)</option>
                    <option value="Onepay">📱 BCEL OnePay</option>
                    <option value="LDB">🏦 ທະນາຄານ LDB</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Description / Memo</label>
                <input 
                  type="text"
                  placeholder="Memo..."
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-white"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                />
              </div>

              {/* Receipt */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Receipt Photo</label>
                <input 
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={e => setFormData({...formData, receipt: e.target.files?.[0] || null})}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-emerald-500/10 file:text-emerald-600 cursor-pointer"
                />
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-white font-black text-xs uppercase rounded-2xl transition-all shadow-lg shadow-emerald-500/20"
              >
                {loading ? 'Processing...' : (isEditing ? 'Update Transaction' : 'Save Transaction')}
              </button>
            </form>
          </div>
        </div>

        {/* FEED & TABLE (7 Cols) */}
        <div className="xl:col-span-7 space-y-6">

          {/* Transactions Ledger */}
          <div className="high-density-card p-0 flex flex-col min-h-[550px] overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            
            <div className="p-4 border-b border-slate-100 dark:border-white/5 flex flex-wrap justify-between items-center gap-2">
              <div className="flex items-center gap-2">
                <input 
                  type="date" 
                  value={viewDate}
                  onChange={e => setViewDate(e.target.value)}
                  className="text-xs font-bold bg-transparent outline-none cursor-pointer text-slate-800 dark:text-white"
                />
                <span className="text-[10px] text-slate-400 font-bold uppercase">({dailyTransactions.length} logs)</span>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto divide-y divide-slate-100 dark:divide-white/5">
              {dailyTransactions.map(tx => {
                const ch = normalizePaymentChannel(tx.source);
                const isInc = tx.type === 'income';

                return (
                  <div key={tx.id} className="p-3.5 flex justify-between items-center hover:bg-slate-50/80 dark:hover:bg-white/5 transition-all">
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-8 rounded-full ${isInc ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{tx.category || 'Transaction'}</p>
                        <p className="text-[10px] text-slate-400">{tx.description || tx.time}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Payment Channel Badge */}
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${
                        ch === 'Cash' ? 'bg-emerald-500/10 text-emerald-600' : ch === 'Onepay' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-600'
                      }`}>
                        {ch}
                      </span>

                      <div className="text-right">
                        <p className={`text-xs font-mono font-black ${isInc ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {showPrivacy ? '••••••' : `${isInc ? '+' : '-'}${Number(tx.amount).toLocaleString()} ₭`}
                        </p>
                        {tx.receiptUrl && (
                          <a href={tx.receiptUrl} target="_blank" rel="noreferrer" className="text-[8.5px] text-blue-500 font-bold uppercase hover:underline">
                            View Receipt
                          </a>
                        )}
                      </div>

                      <div className="flex gap-1">
                        <button onClick={() => startEdit(tx)} className="p-1.5 text-slate-400 hover:text-blue-500">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => startDelete(tx)} className="p-1.5 text-slate-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {dailyTransactions.length === 0 && (
                <div className="p-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                  No records for this date
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

      <PinModal
        isOpen={showEditPinModal}
        onClose={() => setShowEditPinModal(false)}
        correctPin={appConfig?.masterApprovalPin}
        onSuccess={handleEditConfirmed}
      />

      <PinModal
        isOpen={showDeletePinModal}
        onClose={() => setShowDeletePinModal(false)}
        correctPin={appConfig?.masterApprovalPin}
        onSuccess={handleDeleteConfirmed}
      />

    </div>
  );
}
