import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  where, limit, serverTimestamp, setDoc, doc, getDoc, getDocs, deleteDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { format, isSameMonth, parseISO, subDays } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import { 
  Upload, Receipt, PlusCircle, ArrowUpCircle, ArrowDownCircle, 
  Info, Landmark, Download, BarChart3, Eye, EyeOff, X, Trash2, 
  RefreshCw, Sparkles, CheckCircle, FileText, Wallet, CreditCard,
  Building2, TrendingUp, DollarSign, Calendar, Filter, PieChart,
  Percent, ArrowUpRight, ArrowDownRight, Tag
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
  
  // Transaction lists & live data states
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [dailyTransactions, setDailyTransactions] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any>(null);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Timeframe View Mode: 'month' (This Month) vs 'all' (All-Time)
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');

  // Date View State
  const [viewDate, setViewDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Bank Account Modal State
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankAmount, setBankAmount] = useState(0);
  const [bankChannel, setBankChannel] = useState<PaymentChannel>('Onepay');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'transaction' | 'bank' | null>(null);
  const [pendingAction, setPendingAction] = useState<any>(null);
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

  const formatWithCommas = (val: string) => {
    const num = val.replace(/,/g, '');
    if (!num) return '';
    if (isNaN(Number(num))) return displayAmount;
    return Number(num).toLocaleString();
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/,/g, '');
    if (rawValue === '' || !isNaN(Number(rawValue))) {
      setDisplayAmount(formatWithCommas(e.target.value));
      setFormData({ ...formData, amount: Number(rawValue) || 0 });
    }
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [oldTxData, setOldTxData] = useState<any>(null);
  const [deleteReceipt, setDeleteReceipt] = useState(false);
  const [showEditPinModal, setShowEditPinModal] = useState(false);
  const [txToEdit, setTxToEdit] = useState<any>(null);

  const [txToDelete, setTxToDelete] = useState<any>(null);
  const [showDeletePinModal, setShowDeletePinModal] = useState(false);
  const [showClearAllPinModal, setShowClearAllPinModal] = useState(false);

  // PDF Statement State
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [statementStartDate, setStatementStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return format(d, 'yyyy-MM-dd');
  });
  const [statementEndDate, setStatementEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [generatingStatement, setGeneratingStatement] = useState(false);

  // Monthly Summary & AI Advisory State
  const [showMonthlySummaryModal, setShowMonthlySummaryModal] = useState(false);
  const [selectedMonthlyMonth, setSelectedMonthlyMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [monthlySummaryData, setMonthlySummaryData] = useState<any>(null);
  const [loadingMonthlySummary, setLoadingMonthlySummary] = useState(false);
  const [generatingMonthlyPDF, setGeneratingMonthlyPDF] = useState(false);

  // Supplier Prices Integration
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [pullDate, setPullDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [billPaymentSources, setBillPaymentSources] = useState<{ [id: string]: PaymentChannel }>({});
  const [importingBillId, setImportingBillId] = useState<string | null>(null);

  // Helper normalizer for payment sources (covers legacy strings)
  const normalizePaymentChannel = (src?: string): PaymentChannel => {
    if (!src) return 'Cash';
    const s = src.toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // Clipboard image paste support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const pastedFile = new File(
              [blob], 
              `pasted-receipt-${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.png`, 
              { type: 'image/png' }
            );
            setFormData(prev => ({ ...prev, receipt: pastedFile }));
            setDeleteReceipt(false);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  // Listen to ALL transactions for executive calculations & branch filter
  useEffect(() => {
    const qAll = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    const branchId = selectedBranch || 'branch_1';

    const unsubscribeAll = onSnapshot(qAll, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const branchFiltered = all.filter((tx: any) => (tx.branchId || 'branch_1') === branchId);
      setAllTransactions(branchFiltered);

      // Filter daily list based on viewDate
      const daily = branchFiltered.filter((tx: any) => tx.date === viewDate);
      daily.sort((a: any, b: any) => (b.time || '').localeCompare(a.time || ''));
      setDailyTransactions(daily);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    const activeSummaryId = branchId === 'branch_1' ? viewDate : `${viewDate}_${branchId}`;
    const summaryRef = doc(db, 'dailySummaries', activeSummaryId);
    
    const unsubscribeSummary = onSnapshot(summaryRef, async (snap) => {
      if (snap.exists()) {
        setDailySummary(snap.data());
      } else {
        setDailySummary(null);
      }
    });

    // Last 7 days overview
    const last7Days = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(viewDate), 6 - i), 'yyyy-MM-dd'));
    const fetchWeekly = async () => {
      const weekly = [];
      for (const d of last7Days) {
        const sDocId = branchId === 'branch_1' ? d : `${d}_${branchId}`;
        const sRef = doc(db, 'dailySummaries', sDocId);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          weekly.push(sSnap.data());
        } else {
          weekly.push({ date: d, income: 0, expenses: 0 });
        }
      }
      setWeeklyData(weekly);
    };
    fetchWeekly();

    return () => {
      unsubscribeAll();
      unsubscribeSummary();
    };
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

  // Sync pullDate and paymentDate with viewDate
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

    let totalRevenue = 0; // Income
    let totalPurchasing = 0; // COGS
    let totalOPEX = 0; // Other operating expenses

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

  // Supplier Bills available to pull for selected pullDate
  const importedSupplierPriceIds = useMemo(() => {
    const ids = new Set<string>();
    allTransactions.forEach((tx) => {
      if (tx.supplierPriceIds && Array.isArray(tx.supplierPriceIds)) {
        tx.supplierPriceIds.forEach((id: string) => ids.add(id));
      }
    });
    return ids;
  }, [allTransactions]);

  const supplierBillsForSelectedDate = useMemo(() => {
    const selectedDatePrices = supplierPrices.filter(p => p.date === pullDate);

    const isOther = (name: string) => {
      const n = (name || '').trim().toUpperCase();
      return n === 'OTHER' || n === 'ອື່ນໆ' || n === '';
    };

    const nonOtherPrices = selectedDatePrices.filter(p => !isOther(p.supplier));
    const otherPrices = selectedDatePrices.filter(p => isOther(p.supplier));

    const groups: { [supplier: string]: any[] } = {};
    nonOtherPrices.forEach(p => {
      const sup = (p.supplier || '').trim();
      if (!groups[sup]) groups[sup] = [];
      groups[sup].push(p);
    });

    const itemTotalLAK = (item: any): number => {
      if (item.totalPriceLAK !== undefined) return Number(item.totalPriceLAK || 0);
      return item.currency === 'LAK'
        ? Number(item.priceOriginal || 0) * (Number(item.quantity) || 1)
        : Number(item.priceOriginal || 0) * Number(item.exchangeRate || 1) * (Number(item.quantity) || 1);
    };

    const bills: any[] = [];

    Object.keys(groups).forEach(supplierName => {
      const items = groups[supplierName];
      const importedItems = items.filter(it => importedSupplierPriceIds.has(it.id));
      const pendingItems = items.filter(it => !importedSupplierPriceIds.has(it.id));

      if (importedItems.length > 0) {
        const totalPrice = importedItems.reduce((sum, item) => sum + itemTotalLAK(item), 0);
        bills.push({
          id: `grouped_${supplierName}_imported_${pullDate}`,
          supplier: supplierName,
          date: pullDate,
          totalPrice,
          items: importedItems,
          isGrouped: true,
          sourceIds: importedItems.map(it => it.id),
          isImported: true
        });
      }

      if (pendingItems.length > 0) {
        const totalPrice = pendingItems.reduce((sum, item) => sum + itemTotalLAK(item), 0);
        bills.push({
          id: `grouped_${supplierName}_pending_${pullDate}`,
          supplier: supplierName,
          date: pullDate,
          totalPrice,
          items: pendingItems,
          isGrouped: true,
          sourceIds: pendingItems.map(it => it.id),
          isImported: false
        });
      }
    });

    otherPrices.forEach(p => {
      const totalPrice = itemTotalLAK(p);
      const isImported = importedSupplierPriceIds.has(p.id);
      bills.push({
        id: `single_${p.id}`,
        supplier: p.supplier || 'OTHER',
        date: pullDate,
        totalPrice,
        items: [p],
        isGrouped: false,
        sourceIds: [p.id],
        isImported
      });
    });

    return bills;
  }, [supplierPrices, pullDate, importedSupplierPriceIds]);

  // Pull Supplier Bill into Transactions
  const handlePullSupplierBill = async (bill: any) => {
    if (!bill) return;
    try {
      setImportingBillId(bill.id);
      const totalAmount = Math.round(bill.totalPrice || 0);

      if (totalAmount <= 0) {
        alert(i18n.language === 'la' ? 'ຍອດບິນຕ້ອງຫຼາຍກວ່າ 0 ₭' : 'Bill amount must be greater than 0');
        return;
      }

      const selectedSource: PaymentChannel = billPaymentSources[bill.id] || 'Onepay';
      const todayLocal = new Date();
      const localTimeString = `${String(todayLocal.getHours()).padStart(2, '0')}:${String(todayLocal.getMinutes()).padStart(2, '0')}`;

      const pNames = bill.items.map((it: any) => products.find(prod => prod.id === it.productId)?.name || 'Item').join(', ');
      const description = `Purchase supplies from ${bill.supplier}: ${pNames}`;

      await addDoc(collection(db, 'transactions'), {
        type: 'expense',
        amount: totalAmount,
        category: 'Purchasing',
        description,
        source: selectedSource,
        receiptUrl: bill.items[0]?.billImageUrl || '',
        date: paymentDate,
        time: localTimeString,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        supplierName: bill.supplier,
        supplierPriceIds: bill.sourceIds,
        branchId: selectedBranch || 'branch_1'
      });

      alert(i18n.language === 'la' 
        ? `ດຶງລາຍຈ່າຍຈາກ ${bill.supplier} ຈຳນວນ ${totalAmount.toLocaleString()} ₭ (${selectedSource}) ສຳເລັດແລ້ວ!` 
        : `Successfully imported ${bill.supplier}'s purchase bill (${totalAmount.toLocaleString()} ₭) via ${selectedSource}!`);
    } catch (err: any) {
      console.error("Error pulling bill:", err);
      alert(`ເກີດຂໍ້ຜິດພາດ: ${err.message}`);
    } finally {
      setImportingBillId(null);
    }
  };

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
    } catch (err) {
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      return await getDownloadURL(fileRef);
    }
  };

  // Add / Edit Transaction
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
        branchId: selectedBranch || 'branch_1',
        ...(isEditing && oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
        ...(isEditing && oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {})
      };

      if (isEditing && editingId) {
        await setDoc(doc(db, 'transactions', editingId), txData, { merge: true });
        alert(i18n.language === 'la' ? 'ແກ້ໄຂລາຍການສຳເລັດແລ້ວ!' : 'Transaction updated successfully!');
      } else {
        await addDoc(collection(db, 'transactions'), {
          ...txData,
          createdAt: serverTimestamp()
        });
        alert(i18n.language === 'la' ? 'ບັນທຶກລາຍການສຳເລັດແລ້ວ!' : 'Transaction saved successfully!');
      }

      setFormData({
        type: 'expense',
        amount: 0,
        category: 'Purchasing',
        description: '',
        source: 'Cash',
        receipt: null,
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm')
      });
      setDisplayAmount('');
      setIsEditing(false);
      setEditingId(null);
      setOldTxData(null);
      setDeleteReceipt(false);
    } catch (err: any) {
      console.error("Save error:", err);
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
      category: txToEdit.category || 'Purchasing',
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
      alert(i18n.language === 'la' ? 'ລຶບລາຍການສຳເລັດແລ້ວ!' : 'Transaction deleted successfully!');
      setShowDeletePinModal(false);
      setTxToDelete(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBankApproved = async () => {
    try {
      await addDoc(collection(db, 'transactions'), {
        type: 'income',
        amount: bankAmount,
        category: 'opening_balance',
        description: `Bank Opening Balance (${bankChannel})`,
        source: bankChannel,
        date: todayStr,
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        branchId: selectedBranch || 'branch_1'
      });
      setShowBankModal(false);
      setBankAmount(0);
      alert("Bank Opening Balance Recorded!");
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    }
  };

  // Export to Excel
  const handleExport = () => {
    const headers = ['Date', 'Time', 'Type', 'Amount', 'Category', 'Payment Channel', 'Description', 'User'];
    const rows = dailyTransactions.map(tx => [
      tx.date,
      tx.time || '',
      tx.type,
      tx.amount,
      tx.category,
      normalizePaymentChannel(tx.source),
      tx.description || '',
      tx.userEmail
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Financials');
    writeFile(workbook, `financials_${viewDate}.xlsx`);
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
            Inflow: +{Math.round(financialSummary.totalRevenue).toLocaleString()} | Outflow: -{Math.round(financialSummary.totalExpenses).toLocaleString()}
          </p>
        </div>

        {/* Cash In Hand (ເງິນສົດ) */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດໃນມື (Cash)' : 'Cash Balance'}</span>
            </span>
            <span className="text-[9px] font-bold px-2 py-0.5 bg-emerald-500/10 text-emerald-600 rounded-md">Cash</span>
          </div>
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.cashNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.cashIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.cashExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* BCEL OnePay (ເງິນໂອນ OnePay) */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'BCEL OnePay' : 'OnePay Balance'}</span>
            </span>
            <span className="text-[9px] font-bold px-2 py-0.5 bg-red-500/10 text-red-500 rounded-md">OnePay</span>
          </div>
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.onepayNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.onepayIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.onepayExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* LDB Bank (ທະນາຄານ LDB) */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ທະນາຄານ LDB' : 'LDB Balance'}</span>
            </span>
            <span className="text-[9px] font-bold px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded-md">LDB</span>
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

      {/* ================= 3. EXECUTIVE FINANCIAL REPORT (ROI, Margin, Revenue, Net Profit) ================= */}
      <div className="bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-white/10 pb-4">
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span>{i18n.language === 'la' ? 'ບົດລາຍງານປະສິດທິພາບການເງິນ (Financial KPIs)' : 'Financial KPIs & Performance'}</span>
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {i18n.language === 'la' 
                ? 'ຄິດໄລ່ຍອດຂາຍ, ຕົ້ນທຶນວັດຖຸດິບ (Purchasing), ຄ່າດຳເນີນງານ ແລະ ກຳໄລສຸດທິ' 
                : 'Profitability, Gross Margin, and Estimated ROI Analytics'}
            </p>
          </div>

          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-mono font-black w-fit">
            {timeframeMode === 'month' ? '📅 Monthly Performance' : '🌐 All-Time Performance'}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          
          {/* Total Revenue */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
              {i18n.language === 'la' ? 'ຍອດຂາຍ (Revenue)' : 'Total Revenue'}
            </span>
            <p className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
              {showPrivacy ? '••••••' : `${Math.round(financialSummary.totalRevenue).toLocaleString()} ₭`}
            </p>
            <p className="text-[9px] text-slate-400 font-medium">Gross Inflows</p>
          </div>

          {/* Purchasing (COGS) */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
              {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບ (Purchasing)' : 'COGS / Materials'}
            </span>
            <p className="text-lg font-black font-mono text-red-500 dark:text-red-400">
              {showPrivacy ? '••••••' : `${Math.round(financialSummary.totalPurchasing).toLocaleString()} ₭`}
            </p>
            <p className="text-[9px] text-slate-400 font-medium">Material Procurement</p>
          </div>

          {/* Gross Margin % */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <Percent className="w-3.5 h-3.5 text-blue-500" />
              {i18n.language === 'la' ? 'ອັດຕາກຳໄລຂັ້ນຕົ້ນ (Gross Margin)' : 'Gross Margin'}
            </span>
            <p className="text-lg font-black font-mono text-blue-600 dark:text-blue-400">
              {financialSummary.grossMarginPercent.toFixed(1)}%
            </p>
            <p className="text-[9px] text-slate-400 font-medium">
              GP: {Math.round(financialSummary.grossProfit).toLocaleString()} ₭
            </p>
          </div>

          {/* Net Profit */}
          <div className={`p-4 rounded-2xl border space-y-1 ${
            financialSummary.netProfit >= 0 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
          }`}>
            <span className="text-[9.5px] font-black uppercase tracking-wider block">
              {i18n.language === 'la' ? 'ກຳໄລສຸດທິ (Net Profit)' : 'Net Profit'}
            </span>
            <p className="text-lg font-black font-mono">
              {showPrivacy ? '••••••' : `${Math.round(financialSummary.netProfit).toLocaleString()} ₭`}
            </p>
            <p className="text-[9px] opacity-80 font-medium">Revenue - All Expenses</p>
          </div>

          {/* Estimated ROI */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 space-y-1">
            <span className="text-[9.5px] font-black uppercase tracking-wider block">
              {i18n.language === 'la' ? 'ຜົນຕອບແທນ ROI (Est. ROI)' : 'Estimated ROI'}
            </span>
            <p className="text-lg font-black font-mono">
              {financialSummary.estimatedROI.toFixed(1)}%
            </p>
            <p className="text-[9px] opacity-80 font-medium">Return on Total Costs</p>
          </div>

        </div>
      </div>

      <ApprovalModal 
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        onApprove={async () => {
          if (approvalType === 'bank') await handleBankApproved();
          setApprovalType(null);
        }}
        actionType={approvalType === 'bank' ? 'Bank Sync' : 'Save Transaction'}
        masterPin={appConfig?.masterApprovalPin}
      />

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

      {/* ================= 4. TRANSACTION FORM & SUPPLIER PULL ================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* FORM (5 Cols) */}
        <div className="xl:col-span-5 space-y-6">
          <div className="high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-primary" />
                <span>{isEditing ? 'ແກ້ໄຂລາຍການ (Edit)' : 'ບັນທຶກລາຍການໃໝ່ (New Transaction)'}</span>
              </h3>
              {isEditing && (
                <button 
                  onClick={() => {
                    setIsEditing(false);
                    setEditingId(null);
                    setFormData({
                      type: 'expense',
                      amount: 0,
                      category: 'Purchasing',
                      description: '',
                      source: 'Cash',
                      receipt: null,
                      date: format(new Date(), 'yyyy-MM-dd'),
                      time: format(new Date(), 'HH:mm')
                    });
                    setDisplayAmount('');
                  }}
                  className="text-[9px] font-black text-red-500 uppercase"
                >
                  Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleAddTransaction} className="space-y-4">
              
              {/* Type Switcher */}
              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl">
                <button 
                  type="button" 
                  onClick={() => setFormData({...formData, type: 'expense'})}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${formData.type === 'expense' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {t('expense')} (ລາຍຈ່າຍ)
                </button>
                <button 
                  type="button" 
                  onClick={() => setFormData({...formData, type: 'income'})}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${formData.type === 'income' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {t('income')} (ລາຍຮັບ)
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

              {/* Amount */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Amount (₭)</label>
                <input 
                  type="text"
                  required
                  placeholder="0"
                  className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-lg font-mono font-black text-slate-800 dark:text-white"
                  value={displayAmount}
                  onChange={handleAmountChange}
                />
              </div>

              {/* Category & Payment Channel */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Category</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.category}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                    required
                  >
                    <option value="Purchasing">🛒 Purchasing (ວັດຖຸດິບ)</option>
                    <option value="Sales">📈 Sales (ຍອດຂາຍ)</option>
                    <option value="rent">🏠 Rent (ຄ່າເຊົ່າ)</option>
                    <option value="salary">👥 Salary (ເງິນເດືອນ)</option>
                    <option value="operations">⚙️ Operations (ດຳເນີນງານ)</option>
                    <option value="admin">💼 Admin (ບໍລິຫານ)</option>
                    <option value="electricity">⚡ Electricity (ຄ່າໄຟ)</option>
                    <option value="water">💧 Water (ຄ່ານ້ຳ)</option>
                    <option value="other">📦 Other (ອື່ນໆ)</option>
                  </select>
                </div>

                {/* Payment Channel: Cash, Onepay, LDB */}
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Payment Channel</label>
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
                <label className="text-[9.5px] font-black uppercase text-slate-400">Description / Note</label>
                <input 
                  type="text"
                  placeholder="Memo..."
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-white"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                />
              </div>

              {/* Receipt Upload */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Receipt Image</label>
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

          {/* Supplier Pull Purchases Widget */}
          <div className="high-density-card bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>{i18n.language === 'la' ? 'ດຶງລາຍຈ່າຍຜູ້ສະໜອງ' : 'Pull Supplier Purchases'}</span>
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input 
                type="date"
                value={pullDate}
                onChange={e => setPullDate(e.target.value)}
                className="w-full h-9 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold"
              />
              <input 
                type="date"
                value={paymentDate}
                onChange={e => setPaymentDate(e.target.value)}
                className="w-full h-9 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-blue-500"
              />
            </div>

            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {supplierBillsForSelectedDate.length === 0 ? (
                <p className="text-[10px] text-slate-400 font-bold uppercase text-center py-4">No supplier bills for this date</p>
              ) : (
                supplierBillsForSelectedDate.map(bill => (
                  <div key={bill.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-slate-800 dark:text-white">{bill.supplier}</span>
                      <span className="text-xs font-mono font-black text-slate-800 dark:text-white">
                        {Math.round(bill.totalPrice).toLocaleString()} ₭
                      </span>
                    </div>

                    {!bill.isImported ? (
                      <div className="flex gap-2 items-center pt-1">
                        <select 
                          value={billPaymentSources[bill.id] || 'Onepay'}
                          onChange={e => setBillPaymentSources({...billPaymentSources, [bill.id]: e.target.value as PaymentChannel})}
                          className="h-8 px-2 rounded-lg bg-white dark:bg-slate-800 border text-[10px] font-bold"
                        >
                          <option value="Onepay">📱 OnePay</option>
                          <option value="Cash">💵 Cash</option>
                          <option value="LDB">🏦 LDB</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handlePullSupplierBill(bill)}
                          disabled={importingBillId === bill.id}
                          className="flex-1 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase"
                        >
                          {importingBillId === bill.id ? 'Importing...' : 'Pull Expense'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-[9px] text-emerald-500 font-black uppercase block">✓ Already Imported</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* FEED & TABLE (7 Cols) */}
        <div className="xl:col-span-7 space-y-6">

          {/* Weekly Chart */}
          <div className="high-density-card p-0 flex flex-col overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            <div className="p-3.5 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
              <h4 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
                <span>Weekly Inflows & Outflows</span>
              </h4>
            </div>
            <div className="p-4 h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.5} />
                  <XAxis dataKey="date" tick={{fontSize: 9}} tickFormatter={(val) => format(new Date(val), 'dd/MM')} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#052659', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                    formatter={(val: number) => [`${val.toLocaleString()} ₭`, '']}
                  />
                  <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                  <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Transactions Ledger */}
          <div className="high-density-card p-0 flex flex-col min-h-[500px] overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            
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

              <div className="flex gap-2">
                <button 
                  onClick={handleExport}
                  className="px-3 py-1 bg-slate-100 dark:bg-white/10 rounded-xl text-[10px] font-black uppercase text-blue-500 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Excel
                </button>
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

    </div>
  );
}
