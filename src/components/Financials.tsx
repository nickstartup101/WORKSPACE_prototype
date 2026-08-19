import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, 
  serverTimestamp, setDoc, doc, deleteDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { format, subDays } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { 
  Upload, PlusCircle, Download, BarChart3, Eye, EyeOff, X, Trash2, 
  Sparkles, Wallet, CreditCard, Building2, TrendingUp, DollarSign, 
  Calendar, Filter, PieChart, Percent, ArrowUpRight, ArrowDownRight, Tag,
  Image as ImageIcon, Edit3
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import ApprovalModal from './ApprovalModal';
import PinModal from './PinModal';

export type PaymentChannel = 'Cash' | 'Onepay' | 'LDB';

// 🛡️ 1. SAFE DATE NORMALIZER (ຮອງຮັບທຸກຮູບແບບວັນທີ String, Timestamp, Date)
const toStandardDateString = (raw: any): string => {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const clean = raw.trim();
    if (clean.includes('T')) return clean.split('T')[0];
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 3) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
    }
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    return clean;
  }
  if (raw && typeof raw.toDate === 'function') {
    try {
      return format(raw.toDate(), 'yyyy-MM-dd');
    } catch {
      return '';
    }
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    try {
      return format(raw, 'yyyy-MM-dd');
    } catch {
      return '';
    }
  }
  return '';
};

// 🛡️ 2. SAFE NUMBER PARSER (ປ້ອງກັນ NaN ຫຼື String ຕິດຈຸດ)
const parseAmount = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const clean = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export default function Financials({ appConfig, selectedBranch }: { appConfig: any, selectedBranch?: string }) {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Core Data States
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Timeframe View Mode: 'month' vs 'all'
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');

  // Date View State
  const [viewDate, setViewDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [showAllMonthRecords, setShowAllMonthRecords] = useState(false);

  // Drag & Drop State for Receipts
  const [isDraggingReceipt, setIsDraggingReceipt] = useState(false);
  const [previewReceiptModalUrl, setPreviewReceiptModalUrl] = useState<string | null>(null);

  // Bank Opening Balance Modal State
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankAmount, setBankAmount] = useState(0);
  const [bankChannel, setBankChannel] = useState<PaymentChannel>('Onepay');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'transaction' | 'bank' | null>(null);
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Transaction Form State
  const [formData, setFormData] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: 0,
    category: 'Purchasing',
    description: '',
    source: 'Cash' as PaymentChannel,
    receipt: null as File | null,
    receiptPreviewUrl: '' as string,
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
      setFormData(prev => ({ ...prev, amount: Number(rawValue) || 0 }));
    }
  };

  // Editing & Security Pin State
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
  const [pullDate, setPullDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [paymentDate, setPaymentDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [billPaymentSources, setBillPaymentSources] = useState<{ [id: string]: PaymentChannel }>({});
  const [importingBillId, setImportingBillId] = useState<string | null>(null);

  // Normalizer for payment channels
  const normalizePaymentChannel = (src?: string): PaymentChannel => {
    if (!src) return 'Cash';
    const s = String(src).toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // Receipt Drag & Drop & Paste Handlers
  const processReceiptFile = (file: File) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert(i18n.language === 'la' ? 'ຂະໜາດໄຟລ໌ໃຫຍ່ເກີນ 8MB' : 'File is larger than 8MB.');
      return;
    }
    const preview = URL.createObjectURL(file);
    setFormData(prev => ({
      ...prev,
      receipt: file,
      receiptPreviewUrl: preview
    }));
    setDeleteReceipt(false);
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const pastedFile = new File([blob], `receipt-${Date.now()}.png`, { type: 'image/png' });
            processReceiptFile(pastedFile);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingReceipt(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingReceipt(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingReceipt(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processReceiptFile(files[0]);
    }
  };

  const handleUploadToStorage = async (file: File, uploadDate: string) => {
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

  // Safe Realtime Subscription
  useEffect(() => {
    const branchId = selectedBranch || 'branch_1';
    const qAll = query(collection(db, 'transactions'));

    const unsubscribeAll = onSnapshot(qAll, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const branchFiltered = all.filter((tx: any) => (tx.branchId || 'branch_1') === branchId);

      branchFiltered.sort((a: any, b: any) => {
        const dateA = toStandardDateString(a.date || a.createdAt);
        const dateB = toStandardDateString(b.date || b.createdAt);
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return String(b.time || '').localeCompare(String(a.time || ''));
      });

      setAllTransactions(branchFiltered);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
      setLoading(false);
    });

    return () => unsubscribeAll();
  }, [selectedBranch]);

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

  // Filtered Daily Transactions
  const dailyTransactions = useMemo(() => {
    const targetDate = toStandardDateString(viewDate) || format(new Date(), 'yyyy-MM-dd');
    
    if (showAllMonthRecords && targetDate) {
      const [year, month] = targetDate.split('-');
      const monthPrefix = `${year}-${month}`;
      return allTransactions.filter((tx: any) => {
        const d = toStandardDateString(tx.date || tx.createdAt);
        return d.startsWith(monthPrefix);
      });
    }

    return allTransactions.filter((tx: any) => {
      const d = toStandardDateString(tx.date || tx.createdAt);
      return d === targetDate;
    });
  }, [allTransactions, viewDate, showAllMonthRecords]);

  // 7-Day Chart computed in-memory
  const weeklyData = useMemo(() => {
    const standardDate = toStandardDateString(viewDate) || format(new Date(), 'yyyy-MM-dd');
    let validBase = new Date();
    
    if (standardDate) {
      const parts = standardDate.split('-');
      if (parts.length === 3) {
        const parsed = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        if (!isNaN(parsed.getTime())) validBase = parsed;
      }
    }

    return Array.from({ length: 7 }, (_, i) => {
      const dObj = subDays(validBase, 6 - i);
      const targetDate = format(dObj, 'yyyy-MM-dd');
      const dayTxs = allTransactions.filter(tx => toStandardDateString(tx.date || tx.createdAt) === targetDate);

      let income = 0;
      let expenses = 0;

      dayTxs.forEach(tx => {
        const amt = parseAmount(tx.amount);
        if (tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales') {
          income += amt;
        } else {
          expenses += amt;
        }
      });

      return {
        date: targetDate,
        displayDate: format(dObj, 'dd/MM'),
        income,
        expenses
      };
    });
  }, [allTransactions, viewDate]);

  useEffect(() => {
    if (viewDate) {
      const std = toStandardDateString(viewDate);
      setPullDate(std);
      setPaymentDate(std);
    }
  }, [viewDate]);

  // Financial KPIs Calculation
  const financialSummary = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = format(now, 'yyyy-MM');

    const activeList = allTransactions.filter(tx => {
      if (timeframeMode === 'all') return true;
      const dStr = toStandardDateString(tx.date || tx.createdAt);
      if (!dStr) return true;
      return dStr.startsWith(currentMonthPrefix);
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
      const amt = parseAmount(tx.amount);
      const ch = normalizePaymentChannel(tx.source);
      const isIncome = tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales';

      if (isIncome) {
        totalRevenue += amt;
        if (ch === 'Cash') cashIncome += amt;
        else if (ch === 'Onepay') onepayIncome += amt;
        else if (ch === 'LDB') ldbIncome += amt;
      } else {
        const cat = String(tx.category || '').toLowerCase();
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

  // Supplier Bills List
  const importedSupplierPriceIds = useMemo(() => {
    const ids = new Set<string>();
    allTransactions.forEach((tx) => {
      if (Array.isArray(tx.supplierPriceIds)) {
        tx.supplierPriceIds.forEach((id: string) => ids.add(id));
      }
    });
    return ids;
  }, [allTransactions]);

  const supplierBillsForSelectedDate = useMemo(() => {
    const selectedDatePrices = supplierPrices.filter(p => toStandardDateString(p.date) === pullDate);

    const isOther = (name: string) => {
      const n = String(name || '').trim().toUpperCase();
      return n === 'OTHER' || n === 'ອື່ນໆ' || n === '';
    };

    const nonOtherPrices = selectedDatePrices.filter(p => !isOther(p.supplier));
    const otherPrices = selectedDatePrices.filter(p => isOther(p.supplier));

    const groups: { [supplier: string]: any[] } = {};
    nonOtherPrices.forEach(p => {
      const sup = String(p.supplier || '').trim();
      if (!groups[sup]) groups[sup] = [];
      groups[sup].push(p);
    });

    const itemTotalLAK = (item: any): number => {
      if (item.totalPriceLAK !== undefined) return parseAmount(item.totalPriceLAK);
      return item.currency === 'LAK'
        ? parseAmount(item.priceOriginal) * (parseAmount(item.quantity) || 1)
        : parseAmount(item.priceOriginal) * parseAmount(item.exchangeRate || 1) * (parseAmount(item.quantity) || 1);
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

      const pNames = (bill.items || []).map((it: any) => products.find(prod => prod.id === it.productId)?.name || 'Item').join(', ');
      const description = `Purchase supplies from ${bill.supplier}: ${pNames}`;

      await addDoc(collection(db, 'transactions'), {
        type: 'expense',
        amount: totalAmount,
        category: 'Purchasing',
        description,
        source: selectedSource,
        receiptUrl: bill.items?.[0]?.billImageUrl || '',
        date: paymentDate || format(new Date(), 'yyyy-MM-dd'),
        time: localTimeString,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        supplierName: bill.supplier,
        supplierPriceIds: bill.sourceIds || [],
        branchId: selectedBranch || 'branch_1'
      });

      alert(i18n.language === 'la' ? 'ດຶງລາຍຈ່າຍເຂົ້າບັນຊີສຳເລັດ!' : 'Imported successfully!');
    } catch (err: any) {
      console.error(err);
      alert(`Error: ${err.message}`);
    } finally {
      setImportingBillId(null);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      let receiptUrl = '';
      if (formData.receipt && typeof formData.receipt !== 'string') {
        receiptUrl = await handleUploadToStorage(formData.receipt, formData.date);
      } else if (isEditing && !deleteReceipt) {
        receiptUrl = oldTxData?.receiptUrl || '';
      }

      const cleanDate = toStandardDateString(formData.date) || format(new Date(), 'yyyy-MM-dd');

      const txData = {
        type: formData.type,
        amount: parseAmount(formData.amount),
        category: formData.category,
        description: formData.description,
        source: formData.source,
        receiptUrl,
        date: cleanDate,
        time: formData.time || format(new Date(), 'HH:mm'),
        updatedAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        branchId: selectedBranch || 'branch_1',
        ...(isEditing && oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
        ...(isEditing && oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {})
      };

      if (isEditing && editingId) {
        await setDoc(doc(db, 'transactions', editingId), txData, { merge: true });
        alert(i18n.language === 'la' ? 'ແກ້ໄຂລາຍການສຳເລັດ!' : 'Updated!');
      } else {
        await addDoc(collection(db, 'transactions'), {
          ...txData,
          createdAt: serverTimestamp()
        });
        alert(i18n.language === 'la' ? 'ບັນທຶກລາຍການສຳເລັດ!' : 'Saved!');
      }

      setFormData({
        type: 'expense',
        amount: 0,
        category: 'Purchasing',
        description: '',
        source: 'Cash',
        receipt: null,
        receiptPreviewUrl: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm')
      });
      setDisplayAmount('');
      setIsEditing(false);
      setEditingId(null);
      setOldTxData(null);
      setDeleteReceipt(false);
    } catch (err: any) {
      console.error(err);
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
    const cleanDate = toStandardDateString(txToEdit.date || txToEdit.createdAt) || format(new Date(), 'yyyy-MM-dd');
    setFormData({
      type: txToEdit.type,
      amount: parseAmount(txToEdit.amount),
      category: txToEdit.category || 'Purchasing',
      description: txToEdit.description || '',
      source: normalizePaymentChannel(txToEdit.source),
      receipt: null,
      receiptPreviewUrl: txToEdit.receiptUrl || '',
      date: cleanDate,
      time: txToEdit.time || format(new Date(), 'HH:mm')
    });
    setDisplayAmount(parseAmount(txToEdit.amount).toLocaleString());
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
      alert(i18n.language === 'la' ? 'ລຶບລາຍການສຳເລັດ!' : 'Deleted!');
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
      alert("Recorded!");
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    }
  };

  const handleExport = () => {
    const headers = ['Date', 'Time', 'Type', 'Amount (LAK)', 'Category', 'Payment Channel', 'Description', 'User'];
    const rows = dailyTransactions.map(tx => [
      toStandardDateString(tx.date || tx.createdAt),
      tx.time || '',
      tx.type,
      parseAmount(tx.amount),
      tx.category,
      normalizePaymentChannel(tx.source),
      tx.description || '',
      tx.userEmail
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Financials');
    writeFile(workbook, `financials_${viewDate || 'report'}.xlsx`);
  };

  return (
    <div className="space-y-6">
      
      {/* ================= 1. TOP BAR ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              {i18n.language === 'la' ? 'ລະບົບການເງິນ & ບັນຊີ (Financials)' : 'Financials Desk'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {timeframeMode === 'month' 
                ? (i18n.language === 'la' ? `ກຳລັງສະແດງ: ສະເພາະເດືອນນີ້ (${format(new Date(), 'MMMM yyyy')})` : `Viewing: Current Month (${format(new Date(), 'MMMM yyyy')})`)
                : (i18n.language === 'la' ? 'ກຳລັງສະແດງ: ຍອດລວມທັງໝົດ (All-Time)' : 'Viewing: All-Time Data')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200 dark:border-white/10">
            <button
              type="button"
              onClick={() => setTimeframeMode('month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                timeframeMode === 'month' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ພາຍໃນເດືອນນີ້' : 'This Month'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTimeframeMode('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                timeframeMode === 'all' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
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

      {/* ================= 2. PAYMENT CHANNELS CARDS ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-[#052659] to-[#073069] text-white p-5 rounded-3xl shadow-xl space-y-2 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#5483B3]">
              {i18n.language === 'la' ? 'ຍອດເງິນຄົງເຫຼືອລວມ' : 'Total Net Cashflow'}
            </span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-black font-mono">
            {showPrivacy ? '••••••••' : `${Math.round(financialSummary.totalNetLiquidity).toLocaleString()} ₭`}
          </p>
          <p className="text-[9px] text-blue-200/60 font-bold uppercase">
            In: +{Math.round(financialSummary.totalRevenue).toLocaleString()} | Out: -{Math.round(financialSummary.totalExpenses).toLocaleString()}
          </p>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດ (Cash)' : 'Cash Balance'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded">Cash</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.cashNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.cashIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.cashExpense).toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />
              <span>BCEL OnePay</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded">OnePay</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.onepayNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.onepayIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.onepayExpense).toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ທະນາຄານ LDB' : 'LDB Balance'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded">LDB</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {showPrivacy ? '••••••' : `${Math.round(financialSummary.ldbNet).toLocaleString()} ₭`}
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold">
            <span className="text-emerald-500">+{Math.round(financialSummary.ldbIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialSummary.ldbExpense).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* ================= 3. FINANCIAL KPIS ================= */}
      <div className="bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
          <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span>{i18n.language === 'la' ? 'ບົດລາຍງານປະສິດທິພາບການເງິນ (Financial KPIs)' : 'Financial KPIs'}</span>
          </h3>
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-mono font-black">
            {timeframeMode === 'month' ? '📅 Monthly' : '🌐 All-Time'}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
              {i18n.language === 'la' ? 'ຍອດຂາຍ (Revenue)' : 'Revenue'}
            </span>
            <p className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
              {showPrivacy ? '••••••' : `${Math.round(financialSummary.totalRevenue).toLocaleString()} ₭`}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
              <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
              {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບ (COGS)' : 'COGS'}
            </span>
            <p className="text-lg font-black font-mono text-red-500 dark:text-red-400">
              {showPrivacy ? '••••••' : `${Math.round(financialSummary.totalPurchasing).toLocaleString()} ₭`}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
              <Percent className="w-3.5 h-3.5 text-blue-500" />
              {i18n.language === 'la' ? 'ອັດຕາກຳໄລຂັ້ນຕົ້ນ' : 'Gross Margin'}
            </span>
            <p className="text-lg font-black font-mono text-blue-600 dark:text-blue-400">
              {financialSummary.grossMarginPercent.toFixed(1)}%
            </p>
          </div>

          <div className={`p-4 rounded-2xl border space-y-1 ${
            financialSummary.netProfit >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
          }`}>
            <span className="text-[9.5px] font-black uppercase block">
              {i18n.language === 'la' ? 'ກຳໄລສຸດທິ (Net Profit)' : 'Net Profit'}
            </span>
            <p className="text-lg font-black font-mono">
              {showPrivacy ? '••••••' : `${Math.round(financialSummary.netProfit).toLocaleString()} ₭`}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 space-y-1">
            <span className="text-[9.5px] font-black uppercase block">
              {i18n.language === 'la' ? 'ຜົນຕອບແທນ ROI' : 'Est. ROI'}
            </span>
            <p className="text-lg font-black font-mono">
              {financialSummary.estimatedROI.toFixed(1)}%
            </p>
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

      {/* ================= 4. FORM & FEED ROW ================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* LEFT: FORM & SUPPLIER PULL (5 Cols) */}
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
                      receiptPreviewUrl: '',
                      date: format(new Date(), 'yyyy-MM-dd'),
                      time: format(new Date(), 'HH:mm')
                    });
                    setDisplayAmount('');
                  }}
                  className="text-[9px] font-black text-red-500 uppercase hover:underline cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <form onSubmit={handleAddTransaction} className="space-y-4">
              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl">
                <button 
                  type="button" 
                  onClick={() => setFormData(prev => ({...prev, type: 'expense'}))}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${formData.type === 'expense' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {t('expense')} (ລາຍຈ່າຍ)
                </button>
                <button 
                  type="button" 
                  onClick={() => setFormData(prev => ({...prev, type: 'income'}))}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${formData.type === 'income' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
                >
                  {t('income')} (ລາຍຮັບ)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Date</label>
                  <input 
                    type="date"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white cursor-pointer"
                    value={formData.date}
                    onChange={e => {
                      const val = toStandardDateString(e.target.value);
                      if (val) setFormData(prev => ({...prev, date: val}));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Time</label>
                  <input 
                    type="time"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.time}
                    onChange={e => setFormData(prev => ({...prev, time: e.target.value}))}
                  />
                </div>
              </div>

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

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Category</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white cursor-pointer"
                    value={formData.category}
                    onChange={e => setFormData(prev => ({...prev, category: e.target.value}))}
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

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Payment Channel</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white cursor-pointer"
                    value={formData.source}
                    onChange={e => setFormData(prev => ({...prev, source: e.target.value as PaymentChannel}))}
                  >
                    <option value="Cash">💵 Cash (ເງິນສົດ)</option>
                    <option value="Onepay">📱 BCEL OnePay</option>
                    <option value="LDB">🏦 ທະນາຄານ LDB</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Description</label>
                <input 
                  type="text"
                  placeholder="Memo..."
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-white"
                  value={formData.description}
                  onChange={e => setFormData(prev => ({...prev, description: e.target.value}))}
                />
              </div>

              {/* RECEIPT BOX */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`space-y-2 p-3.5 rounded-2xl border-2 border-dashed transition-all ${
                  isDraggingReceipt
                    ? 'border-emerald-500 bg-emerald-500/10 scale-[1.01]'
                    : 'border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-[#052659]/50 hover:border-slate-400'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="text-[9.5px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                    <span>{i18n.language === 'la' ? 'ຮູບໃບບິນແນບ (Drop / Ctrl+V)' : 'Receipt Photo (Drop / Ctrl+V)'}</span>
                  </span>
                  {(formData.receipt || formData.receiptPreviewUrl) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, receipt: null, receiptPreviewUrl: '' }));
                        setDeleteReceipt(true);
                      }}
                      className="text-[9px] font-black text-red-500 hover:underline uppercase cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {formData.receiptPreviewUrl ? (
                  <div className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 max-h-36 bg-black/10 flex items-center justify-center">
                    <img src={formData.receiptPreviewUrl} alt="Receipt Preview" className="w-full h-36 object-cover" />
                    <button
                      type="button"
                      onClick={() => setPreviewReceiptModalUrl(formData.receiptPreviewUrl)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-4 h-4" />
                      <span>{i18n.language === 'la' ? 'ເບິ່ງຮູບເຕັມ' : 'View Full'}</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <input 
                      type="file"
                      ref={fileInputRef}
                      accept="image/*,application/pdf"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) processReceiptFile(file);
                      }}
                      className="hidden"
                      id="finance-receipt-upload"
                    />
                    <label 
                      htmlFor="finance-receipt-upload"
                      className="w-full py-3.5 px-3 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-500 dark:text-slate-400"
                    >
                      <Upload className={`w-5 h-5 ${isDraggingReceipt ? 'text-emerald-500 animate-bounce' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        {isDraggingReceipt ? 'Drop here now' : 'Click to upload or Drag & Drop'}
                      </span>
                      <p className="text-[9px] text-slate-400 font-bold uppercase">
                        📋 Or Paste directly with Ctrl + V
                      </p>
                    </label>
                  </div>
                )}
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-white font-black text-xs uppercase rounded-2xl transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
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
                onChange={e => {
                  const val = toStandardDateString(e.target.value);
                  if (val) setPullDate(val);
                }}
                className="w-full h-9 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold cursor-pointer"
              />
              <input 
                type="date"
                value={paymentDate}
                onChange={e => {
                  const val = toStandardDateString(e.target.value);
                  if (val) setPaymentDate(val);
                }}
                className="w-full h-9 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-blue-500 cursor-pointer"
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
                          onChange={e => setBillPaymentSources(prev => ({...prev, [bill.id]: e.target.value as PaymentChannel}))}
                          className="h-8 px-2 rounded-lg bg-white dark:bg-slate-800 border text-[10px] font-bold cursor-pointer"
                        >
                          <option value="Onepay">OnePay</option>
                          <option value="Cash">Cash</option>
                          <option value="LDB">LDB</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handlePullSupplierBill(bill)}
                          disabled={importingBillId === bill.id}
                          className="flex-1 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase cursor-pointer"
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

        {/* RIGHT: CHART & LEDGER FEED (7 Cols) */}
        <div className="xl:col-span-7 space-y-6">

          {/* 7-Day Chart */}
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
                  <XAxis 
                    dataKey="displayDate" 
                    tick={{fontSize: 9}} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#052659', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                    formatter={(val: number) => [`${Number(val || 0).toLocaleString()} ₭`, '']}
                  />
                  <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                  <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Live Transaction Ledger Table with Plain Text Quick Buttons (No icons) */}
          <div className="high-density-card p-0 flex flex-col min-h-[500px] overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            
            <div className="p-4 border-b border-slate-100 dark:border-white/10 flex flex-col gap-3">
              
              <div className="flex flex-wrap justify-between items-center gap-2">
                <div className="flex items-center gap-2">
                  <input 
                    type="date"
                    value={viewDate}
                    onChange={e => {
                      const val = toStandardDateString(e.target.value);
                      if (val) {
                        setViewDate(val);
                        setShowAllMonthRecords(false);
                      }
                    }}
                    className="text-xs font-bold bg-transparent outline-none cursor-pointer text-slate-800 dark:text-white"
                  />
                  <span className="text-[10px] text-slate-400 font-bold uppercase">
                    ({dailyTransactions.length} logs)
                  </span>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={handleExport}
                    className="px-3 py-1 bg-slate-100 dark:bg-white/10 rounded-xl text-[10px] font-black uppercase text-blue-500 flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    Excel
                  </button>
                </div>
              </div>

              {/* Plain Text Navigation Buttons (NO EMOJIS / NO ICONS) */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100 dark:border-white/5 text-[9.5px]">
                <button
                  type="button"
                  onClick={() => {
                    setViewDate(format(new Date(), 'yyyy-MM-dd'));
                    setShowAllMonthRecords(false);
                  }}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-lg font-bold cursor-pointer transition-all"
                >
                  {i18n.language === 'la' ? 'ມື້ນີ້' : 'Today'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    // Safe 1st day of active month string (No Date Object Bug)
                    const activeDateStr = toStandardDateString(viewDate) || format(new Date(), 'yyyy-MM-dd');
                    const [y, m] = activeDateStr.split('-');
                    const firstDay = `${y}-${m}-01`;
                    setViewDate(firstDay);
                    setShowAllMonthRecords(false);
                  }}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-lg font-bold cursor-pointer transition-all"
                >
                  {i18n.language === 'la' ? 'ຕົ້ນເດືອນ' : '1st of Month'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const yest = format(subDays(new Date(), 1), 'yyyy-MM-dd');
                    setViewDate(yest);
                    setShowAllMonthRecords(false);
                  }}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-lg font-bold cursor-pointer transition-all"
                >
                  {i18n.language === 'la' ? 'ມື້ວານ' : 'Yesterday'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowAllMonthRecords(prev => !prev)}
                  className={`px-3 py-1 rounded-lg font-black uppercase transition-all cursor-pointer ${
                    showAllMonthRecords 
                      ? 'bg-blue-600 text-white shadow-xs' 
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {showAllMonthRecords 
                    ? (i18n.language === 'la' ? 'ສະແດງທັງເດືອນ' : 'Showing Month') 
                    : (i18n.language === 'la' ? 'ເບິ່ງທັງໝົດໃນເດືອນນີ້' : 'View Entire Month')}
                </button>
              </div>

            </div>

            <div className="flex-1 overflow-x-auto divide-y divide-slate-100 dark:divide-white/5">
              {dailyTransactions.map(tx => {
                const ch = normalizePaymentChannel(tx.source);
                const isInc = tx.type === 'income';

                return (
                  <div key={tx.id || Math.random()} className="p-3.5 flex justify-between items-center hover:bg-slate-50/80 dark:hover:bg-white/5 transition-all">
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-8 rounded-full ${isInc ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{tx.category || 'Transaction'}</p>
                        <p className="text-[10px] text-slate-400">
                          {toStandardDateString(tx.date || tx.createdAt)} • {tx.time || ''} {tx.description ? `• ${tx.description}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${
                        ch === 'Cash' ? 'bg-emerald-500/10 text-emerald-600' : ch === 'Onepay' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-600'
                      }`}>
                        {ch}
                      </span>

                      <div className="text-right">
                        <p className={`text-xs font-mono font-black ${isInc ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {showPrivacy ? '••••••' : `${isInc ? '+' : '-'}${parseAmount(tx.amount).toLocaleString()} ₭`}
                        </p>
                        {tx.receiptUrl && (
                          <button 
                            type="button"
                            onClick={() => setPreviewReceiptModalUrl(tx.receiptUrl)}
                            className="text-[8.5px] text-blue-500 font-bold uppercase hover:underline cursor-pointer"
                          >
                            View Receipt ↗
                          </button>
                        )}
                      </div>

                      <div className="flex gap-1">
                        <button onClick={() => startEdit(tx)} className="p-1.5 text-slate-400 hover:text-blue-500 cursor-pointer">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => startDelete(tx)} className="p-1.5 text-slate-400 hover:text-red-500 cursor-pointer">
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

      {/* ================= RECEIPT VIEWER POPUP MODAL ================= */}
      {previewReceiptModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col space-y-4 max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-500" />
                <span>Attached Receipt Document</span>
              </h4>
              <button 
                type="button" 
                onClick={() => setPreviewReceiptModalUrl(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-2xl bg-black/5 flex items-center justify-center p-2">
              <img 
                src={previewReceiptModalUrl} 
                alt="Receipt Full View" 
                className="max-h-[70vh] w-auto object-contain rounded-xl shadow-md"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
