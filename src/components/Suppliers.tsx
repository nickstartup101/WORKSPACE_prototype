import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Plus, Trash2, Edit3, Save, X, Search, Download, 
  BarChart3, List, Check, Receipt, ShoppingBag, 
  Image as ImageIcon, Upload, Eye, Wallet, CreditCard,
  Building2, TrendingUp, DollarSign, Calendar, Filter, PieChart,
  Percent, ArrowUpRight, ArrowDownRight, Tag, Sparkles
} from 'lucide-react';
import { format, isSameMonth, parseISO } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';
import { COMMON_RESOURCES } from '../constants';
import ApprovalModal from './ApprovalModal';

// Supplier Code abbreviations for automatic Bill No generation
const SUPPLIER_CODES: Record<string, string> = {
  'CHANHOM': 'CH',
  'LATDA': 'LD',
  'HEAVENLY': 'HV',
  'DMART': 'DM',
  'MARRY ANN': 'MA',
  'OTHER': 'OT'
};

export type PaymentMethod = 'Cash' | 'Onepay' | 'LDB';
export type ExpenseCategory = 'purchasing' | 'rental' | 'salary' | 'operation' | 'admin' | 'sales' | 'other';

interface FormItemRow {
  id: string;
  productId: string;
  productSearch: string;
  unit: string;
  priceMode: 'total' | 'per_pack';
  priceOriginal: number;
  displayPrice: string;
  quantity: number;
  quantityPerUnit: number;
  remark: string;
  isDropdownOpen?: boolean;
}

export default function Suppliers() {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [financeTransactions, setFinanceTransactions] = useState<any[]>([]);
  const [selectedFilterDate, setSelectedFilterDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  
  // View Timeframe Switcher: 'month' (This Month) vs 'all' (All-Time)
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'all'>('month');

  // Entry Mode Switcher: 'batch' (Multi-Item in 1 Bill) vs 'single' (Single Item Fast Entry)
  const [entryMode, setEntryMode] = useState<'batch' | 'single'>('batch');

  // Drag & Drop Highlight state
  const [isDragging, setIsDragging] = useState(false);

  // Product Manager Modal States
  const [showProductManager, setShowProductManager] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editProductName, setEditProductName] = useState('');
  const [editProductUnit, setEditProductUnit] = useState('');
  const [editProductIsDurable, setEditProductIsDurable] = useState(false);
  const [editProductBoxSize, setEditProductBoxSize] = useState<number>(12);

  // Edit Single Historical Price Modal
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceData, setEditPriceData] = useState<any>(null);

  // Receipt Viewer Modal
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // --- Bill Entry Form States ---
  const [billDate, setBillDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [billTime, setBillTime] = useState<string>(format(new Date(), 'HH:mm'));
  const [supplier, setSupplier] = useState<string>('CHANHOM');
  const [category, setCategory] = useState<ExpenseCategory>('purchasing');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [currency, setCurrency] = useState<string>('LAK');
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [billImageBase64, setBillImageBase64] = useState<string>('');
  const [billRemark, setBillRemark] = useState<string>('');
  const [saveLoading, setSaveLoading] = useState(false);

  // Items list in active bill
  const [billItems, setBillItems] = useState<FormItemRow[]>([
    {
      id: 'item-1',
      productId: '',
      productSearch: '',
      unit: 'UNIT',
      priceMode: 'total',
      priceOriginal: 0,
      displayPrice: '',
      quantity: 1,
      quantityPerUnit: 1,
      remark: '',
      isDropdownOpen: false
    }
  ]);

  // Admin Approval State
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'create' | 'delete' | null>(null);
  const [pendingAction, setPendingAction] = useState<any>(null);

  // Merge Duplicates Modal States
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeMultiplier, setMergeMultiplier] = useState(1);
  const [isMerging, setIsMerging] = useState(false);

  // Auto Bill No Generation: # + DDMMYYYY + SupplierCode (e.g. #14082026CH)
  const generatedBillNo = useMemo(() => {
    try {
      const parts = billDate.split('-');
      if (parts.length === 3) {
        const ddmmyyyy = `${parts[2]}${parts[1]}${parts[0]}`;
        const code = SUPPLIER_CODES[supplier] || (supplier ? supplier.slice(0, 2).toUpperCase() : 'OT');
        return `#${ddmmyyyy}${code}`;
      }
    } catch {
      // fallback
    }
    return `#${format(new Date(), 'ddMMyyyy')}${SUPPLIER_CODES[supplier] || 'OT'}`;
  }, [billDate, supplier]);

  // ================= 🖼️ IMAGE PROCESSOR (COMPRESSION & BASE64) =================
  const processImageFile = (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      alert(i18n.language === 'la' ? 'ກະລຸນາເລືອກໄຟລ໌ຮູບພາບ (JPG, PNG...)' : 'Please provide an image file (JPG, PNG...).');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      alert(i18n.language === 'la' ? 'ຮູບພາບມີຂະໜາດໃຫຍ່ເກີນ 8MB' : 'File is larger than 8MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = img.width > MAX_WIDTH ? MAX_WIDTH : img.width;
        canvas.height = img.width > MAX_WIDTH ? (img.height * scaleSize) : img.height;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        setBillImageBase64(compressedBase64);
      };
    };
    reader.readAsDataURL(file);
  };

  // 📋 1. CLIPBOARD PASTE LISTENER (CTRL + V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            processImageFile(blob);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [i18n.language]);

  // 📂 2. DRAG & DROP HANDLERS
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
  };

  const handleManualFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  // Subscribe to Firestore collections
  useEffect(() => {
    const qP = query(collection(db, 'products'), orderBy('name'));
    const unsubscribeP = onSnapshot(qP, (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });

    const qS = query(collection(db, 'supplierPrices'));
    const unsubscribeS = onSnapshot(qS, (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'supplierPrices');
    });

    const qF = query(collection(db, 'transactions'));
    const unsubscribeF = onSnapshot(qF, (snap) => {
      setFinanceTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return () => {
      unsubscribeP();
      unsubscribeS();
      unsubscribeF();
    };
  }, []);

  // Sort supplierPrices by date descending
  const sortedSupplierPrices = useMemo(() => {
    return [...supplierPrices].sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const timeA = a.time || '';
      const timeB = b.time || '';
      if (timeA !== timeB) return timeB.localeCompare(timeA);
      const secondsA = a.createdAt?.seconds || 0;
      const secondsB = b.createdAt?.seconds || 0;
      return secondsB - secondsA;
    });
  }, [supplierPrices]);

  // ================= 📊 FINANCIAL KPIS & PAYMENT CHANNEL CALCULATION =================
  const financialSummary = useMemo(() => {
    const now = new Date();

    const filterByTimeframe = (recordDateStr?: string) => {
      if (timeframeMode === 'all') return true;
      if (!recordDateStr) return true;
      try {
        const d = parseISO(recordDateStr);
        return isSameMonth(d, now);
      } catch {
        return true;
      }
    };

    const activePrices = supplierPrices.filter(p => filterByTimeframe(p.date));
    const activeFinance = financeTransactions.filter(f => filterByTimeframe(f.date));

    let totalCashSpent = 0;
    let totalOnepaySpent = 0;
    let totalLdbSpent = 0;

    let totalRevenue = 0;
    let totalPurchasing = 0;
    let totalSalary = 0;
    let totalRental = 0;
    let totalOperation = 0;
    let totalAdmin = 0;
    let totalOtherExpense = 0;

    activePrices.forEach(p => {
      const isNew = p.totalPriceLAK !== undefined;
      const amount = isNew
        ? Number(p.totalPriceLAK || 0)
        : (p.currency === 'LAK' ? Number(p.priceOriginal || 0) : Number(p.priceOriginal || 0) * Number(p.exchangeRate || 1)) * (Number(p.quantity) || 1);

      const payMethod: PaymentMethod = p.paymentMethod || 'Cash';
      if (payMethod === 'Cash') totalCashSpent += amount;
      else if (payMethod === 'Onepay') totalOnepaySpent += amount;
      else if (payMethod === 'LDB') totalLdbSpent += amount;

      const cat: ExpenseCategory = p.category || 'purchasing';
      if (cat === 'purchasing') totalPurchasing += amount;
      else if (cat === 'salary') totalSalary += amount;
      else if (cat === 'rental') totalRental += amount;
      else if (cat === 'operation') totalOperation += amount;
      else if (cat === 'admin') totalAdmin += amount;
      else if (cat === 'sales') totalRevenue += amount;
      else totalOtherExpense += amount;
    });

    activeFinance.forEach(f => {
      const amt = Number(f.amount || 0);
      if (f.type === 'income' || f.category === 'sales') {
        totalRevenue += amt;
      } else {
        const cat = (f.category || 'other').toLowerCase();
        if (cat === 'purchasing') totalPurchasing += amt;
        else if (cat === 'salary') totalSalary += amt;
        else if (cat === 'rental') totalRental += amt;
        else if (cat === 'operation') totalOperation += amt;
        else if (cat === 'admin') totalAdmin += amt;
        else totalOtherExpense += amt;

        const pay = f.paymentMethod || 'Cash';
        if (pay === 'Cash') totalCashSpent += amt;
        else if (pay === 'Onepay') totalOnepaySpent += amt;
        else if (pay === 'LDB') totalLdbSpent += amt;
      }
    });

    const totalOPEX = totalSalary + totalRental + totalOperation + totalAdmin + totalOtherExpense;
    const totalAllExpenses = totalPurchasing + totalOPEX;
    const grandTotalSpent = totalCashSpent + totalOnepaySpent + totalLdbSpent;

    const grossProfit = totalRevenue - totalPurchasing;
    const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netProfit = totalRevenue - totalAllExpenses;
    const estimatedROI = totalAllExpenses > 0 ? (netProfit / totalAllExpenses) * 100 : 0;

    return {
      totalCashSpent,
      totalOnepaySpent,
      totalLdbSpent,
      grandTotalSpent,
      totalRevenue,
      totalPurchasing,
      totalOPEX,
      totalAllExpenses,
      grossProfit,
      grossMarginPercent,
      netProfit,
      estimatedROI
    };
  }, [supplierPrices, financeTransactions, timeframeMode]);

  // Latest 10 records for chart
  const lastTenPrices = useMemo(() => {
    return [...supplierPrices].slice(0, 10).reverse().map(p => {
      const isNew = p.totalPriceLAK !== undefined;
      const totalLAK = isNew
        ? Number(p.totalPriceLAK || 0)
        : (p.currency === 'LAK' ? p.priceOriginal : p.priceOriginal * (p.exchangeRate || 1));
      return {
        ...p,
        totalLAK,
      };
    });
  }, [supplierPrices]);

  // Form Row Helpers
  const addNewItemRow = () => {
    setBillItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random()}`,
        productId: '',
        productSearch: '',
        unit: 'UNIT',
        priceMode: 'total',
        priceOriginal: 0,
        displayPrice: '',
        quantity: 1,
        quantityPerUnit: 1,
        remark: '',
        isDropdownOpen: false
      }
    ]);
  };

  const removeItemRow = (index: number) => {
    if (billItems.length <= 1) {
      alert(i18n.language === 'la' ? 'ຕ້ອງມີຢ່າງໜ້ອຍ 1 ລາຍການໃນໃບບິນ' : 'At least 1 item is required.');
      return;
    }
    setBillItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, fields: Partial<FormItemRow>) => {
    setBillItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...fields };
      return updated;
    });
  };

  const formatWithCommas = (val: string) => {
    const num = val.replace(/,/g, '');
    if (!num) return '';
    if (isNaN(Number(num))) return val;
    return Number(num).toLocaleString();
  };

  const handleItemPriceChange = (index: number, rawVal: string) => {
    const cleanNum = rawVal.replace(/,/g, '');
    if (cleanNum === '' || !isNaN(Number(cleanNum))) {
      updateItemRow(index, {
        displayPrice: formatWithCommas(rawVal),
        priceOriginal: Number(cleanNum) || 0
      });
    }
  };

  // Grand Total of current active bill
  const grandTotalLAK = useMemo(() => {
    const rate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);
    return billItems.reduce((acc, item) => {
      const orig = Number(item.priceOriginal) || 0;
      const qty = Number(item.quantity) || 1;
      const totalOrig = item.priceMode === 'total' ? orig : orig * qty;
      return acc + (totalOrig * rate);
    }, 0);
  }, [billItems, currency, exchangeRate]);

  // Submit the Bill (Single or Batch)
  const handleSaveBillBatch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplier) {
      alert(i18n.language === 'la' ? 'ກະລຸນາເລືອກຜູ້ສະໜອງ' : 'Please select a supplier.');
      return;
    }

    for (let i = 0; i < billItems.length; i++) {
      const item = billItems[i];
      if (!item.productId) {
        alert(i18n.language === 'la' 
          ? `ລາຍການທີ ${i + 1} ຍັງບໍ່ໄດ້ເລືອກສິນຄ້າ. ກະລຸນາເລືອກ ຫຼື ເພີ່ມສິນຄ້າໃໝ່` 
          : `Item #${i + 1} does not have a selected product.`);
        return;
      }
    }

    try {
      setSaveLoading(true);
      const batchGroupId = `bill_${Date.now()}`;
      const finalRate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);

      for (const item of billItems) {
        const qty = Number(item.quantity) || 1;
        const qtyPerUnit = Number(item.quantityPerUnit) || 1;
        let singlePriceOriginal = Number(item.priceOriginal) || 0;
        
        if (item.priceMode === 'total') {
          singlePriceOriginal = (Number(item.priceOriginal) || 0) / qty;
        }

        const calculatedPriceLAK = singlePriceOriginal * finalRate;
        const totalOriginal = item.priceMode === 'total' ? Number(item.priceOriginal) || 0 : (Number(item.priceOriginal) || 0) * qty;
        const totalLAK = totalOriginal * finalRate;

        await addDoc(collection(db, 'supplierPrices'), {
          billNo: generatedBillNo,
          batchGroupId,
          billImageUrl: billImageBase64 || '',
          billRemark: billRemark.trim(),
          productId: item.productId,
          supplier,
          category,
          paymentMethod,
          currency,
          exchangeRate: finalRate,
          priceOriginal: singlePriceOriginal,
          priceLAK: calculatedPriceLAK,
          totalPriceOriginal: totalOriginal,
          totalPriceLAK: totalLAK,
          quantity: qty,
          quantityPerUnit: qtyPerUnit,
          unit: item.unit || 'UNIT',
          remark: item.remark || '',
          date: billDate,
          time: billTime,
          priceMode: item.priceMode,
          createdAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
        });
      }

      alert(i18n.language === 'la' 
        ? `ບັນທຶກເລກບິນ ${generatedBillNo} ຈຳນວນ ${billItems.length} ລາຍການສຳເລັດແລ້ວ!` 
        : `Successfully saved Bill ${generatedBillNo} with ${billItems.length} items!`);

      // Reset form
      setBillImageBase64('');
      setBillRemark('');
      setBillItems([
        {
          id: `item-${Date.now()}`,
          productId: '',
          productSearch: '',
          unit: 'UNIT',
          priceMode: 'total',
          priceOriginal: 0,
          displayPrice: '',
          quantity: 1,
          quantityPerUnit: 1,
          remark: '',
          isDropdownOpen: false
        }
      ]);
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (err: any) {
      console.error("Save Error:", err);
      handleFirestoreError(err, OperationType.CREATE, 'supplierPrices');
    } finally {
      setSaveLoading(false);
    }
  };

  // Quick Add unlisted custom product
  const addUnlistedProductForItem = async (name: string, itemIndex: number) => {
    const productName = prompt("Enter New Product Name:", name);
    if (productName) {
      try {
        const docRef = await addDoc(collection(db, 'products'), {
          name: productName.trim(),
          unit: billItems[itemIndex]?.unit || 'UNIT',
          isApproved: true,
          createdAt: serverTimestamp()
        });
        updateItemRow(itemIndex, {
          productId: docRef.id,
          productSearch: productName.trim(),
          isDropdownOpen: false
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'products');
      }
    }
  };

  // Product Master Update / Delete Handlers
  const handleUpdateProductName = async (id: string) => {
    if (!editProductName.trim()) return;
    try {
      setSaveLoading(true);
      await updateDoc(doc(db, 'products', id), {
        name: editProductName.trim(),
        unit: editProductUnit.trim() || 'UNIT',
        isDurable: editProductIsDurable,
        boxSize: Number(editProductBoxSize) || 12,
        updatedAt: serverTimestamp()
      });
      setEditingProduct(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'products');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm(i18n.language === 'la' ? 'ທ່ານແນ່ໃຈບໍ່ທີ່ຈະລົບສິນຄ້ານີ້?' : 'Are you sure you want to delete this product?')) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      alert("Product deleted successfully");
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, 'products');
    }
  };

  // Merge Duplicates
  const handleMergeProducts = async () => {
    if (!mergeSourceId || !mergeTargetId) return;
    if (mergeSourceId === mergeTargetId) return;

    try {
      setIsMerging(true);
      const priceDocs = supplierPrices.filter(sp => sp.productId === mergeSourceId);
      for (const priceDoc of priceDocs) {
        const newQtyPerUnit = (priceDoc.quantityPerUnit || 1) * mergeMultiplier;
        await updateDoc(doc(db, 'supplierPrices', priceDoc.id), {
          productId: mergeTargetId,
          quantityPerUnit: newQtyPerUnit,
          remark: `${priceDoc.remark || ''} (Merged)`.trim()
        });
      }
      await deleteDoc(doc(db, 'products', mergeSourceId));
      alert("Successfully merged products!");
      setShowMergeModal(false);
      setMergeSourceId('');
      setMergeTargetId('');
      setMergeMultiplier(1);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsMerging(false);
    }
  };

  // Update Single Price Entry
  const handleUpdatePrice = async () => {
    if (!editingPriceId || !editPriceData) return;
    try {
      setSaveLoading(true);
      const rate = editPriceData.currency === 'LAK' ? 1 : (Number(editPriceData.exchangeRate) || 1);
      const qty = Number(editPriceData.quantity) || 1;
      const singlePriceOrig = Number(editPriceData.priceOriginal) || 0;
      const calculatedPriceLAK = singlePriceOrig * rate;
      const totalOrig = singlePriceOrig * qty;
      const totalLAK = totalOrig * rate;

      await updateDoc(doc(db, 'supplierPrices', editingPriceId), {
        ...editPriceData,
        exchangeRate: rate,
        priceLAK: calculatedPriceLAK,
        totalPriceOriginal: totalOrig,
        totalPriceLAK: totalLAK,
        updatedAt: serverTimestamp()
      });
      setEditingPriceId(null);
      setEditPriceData(null);
      alert("Record updated successfully");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'supplierPrices');
    } finally {
      setSaveLoading(false);
    }
  };

  const executeApprovedAction = async () => {
    if (approvalType === 'delete' && pendingAction) {
      try {
        await deleteDoc(doc(db, 'supplierPrices', pendingAction));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'supplierPrices');
      }
    }
    setApprovalType(null);
    setPendingAction(null);
  };

  // Export to Excel
  const handleExport = () => {
    const headers = ['Bill No', 'Date', 'Category', 'Payment Method', 'Product', 'Supplier', 'Price LAK', 'Total LAK', 'Quantity', 'Unit', 'Remark', 'User'];
    const rows = sortedSupplierPrices.map(p => [
      p.billNo || '-',
      p.date || format(p.createdAt?.toDate() || new Date(), 'yyyy-MM-dd'),
      p.category || 'purchasing',
      p.paymentMethod || 'Cash',
      products.find(prod => prod.id === p.productId)?.name || 'Unknown',
      p.supplier,
      p.priceLAK || 0,
      p.totalPriceLAK || (p.priceLAK * (p.quantity || 1)),
      p.quantity,
      p.unit,
      p.remark || '',
      p.userEmail || ''
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Suppliers & Finance Report');
    writeFile(workbook, `suppliers_finance_report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-6">
      
      {/* ================= 1. TIMEFRAME SELECTOR & HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl">
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              {i18n.language === 'la' ? 'ລະບົບລາຍຈ່າຍ & ຜູ້ສະໜອງ (Finance & Suppliers)' : 'Finance & Supplier Procurement Hub'}
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-300 font-bold uppercase mt-0.5">
              {timeframeMode === 'month' 
                ? (i18n.language === 'la' ? `ກຳລັງສະແດງ: ສະເພາະເດືອນນີ້ (${format(new Date(), 'MMMM yyyy')})` : `Viewing: Current Month (${format(new Date(), 'MMMM yyyy')})`)
                : (i18n.language === 'la' ? 'ກຳລັງສະແດງ: ຍອດລວມທັງໝົດ (All-Time Data)' : 'Viewing: All-Time Overall Balance')}
            </p>
          </div>
        </div>

        {/* Timeframe Toggle Switch */}
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

          <button 
            type="button" 
            onClick={() => setShowProductManager(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white font-black text-xs uppercase rounded-2xl transition-all cursor-pointer"
          >
            <List className="w-3.5 h-3.5 text-primary" />
            <span>{i18n.language === 'la' ? 'ສິນຄ້າ' : 'Items'}</span>
          </button>
        </div>
      </div>

      {/* ================= 2. PAYMENT CHANNELS CARDS (Cash, Onepay, LDB) ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Liquidity Spent */}
        <div className="bg-gradient-to-br from-[#052659] to-[#073069] text-white p-5 rounded-3xl shadow-xl space-y-2 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#5483B3]">
              {i18n.language === 'la' ? 'ຍອດລາຍຈ່າຍລວມທັງໝົດ' : 'Total Outflow Sum'}
            </span>
            <div className="p-2 bg-white/10 rounded-xl">
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <p className="text-xl font-black font-mono tracking-tight">
            {Math.round(financialSummary.grandTotalSpent).toLocaleString()} ₭
          </p>
          <p className="text-[9.5px] text-blue-200/60 font-bold uppercase">
            {timeframeMode === 'month' ? 'Current Month Total' : 'All Recorded Transactions'}
          </p>
        </div>

        {/* Cash In-Hand */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດ (Cash)' : 'Cash Outflow'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded">Cash</span>
          </div>
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {Math.round(financialSummary.totalCashSpent).toLocaleString()} ₭
          </p>
          <div className="flex items-center justify-between text-[9.5px] text-slate-400 font-bold">
            <span>{i18n.language === 'la' ? 'ຈ່າຍຜ່ານເງິນສົດ' : 'Physical Cash'}</span>
            <span className="text-emerald-500 font-mono">
              {financialSummary.grandTotalSpent > 0 ? ((financialSummary.totalCashSpent / financialSummary.grandTotalSpent) * 100).toFixed(0) : 0}%
            </span>
          </div>
        </div>

        {/* BCEL OnePay */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ໂອນ BCEL OnePay' : 'OnePay Outflow'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded">OnePay</span>
          </div>
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {Math.round(financialSummary.totalOnepaySpent).toLocaleString()} ₭
          </p>
          <div className="flex items-center justify-between text-[9.5px] text-slate-400 font-bold">
            <span>{i18n.language === 'la' ? 'ຈ່າຍຜ່ານ OnePay QR' : 'BCEL QR Transfer'}</span>
            <span className="text-red-500 font-mono">
              {financialSummary.grandTotalSpent > 0 ? ((financialSummary.totalOnepaySpent / financialSummary.grandTotalSpent) * 100).toFixed(0) : 0}%
            </span>
          </div>
        </div>

        {/* LDB Bank */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ໂອນ ທະນາຄານ LDB' : 'LDB Bank Outflow'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded">LDB</span>
          </div>
          <p className="text-xl font-black font-mono tracking-tight text-slate-800 dark:text-white">
            {Math.round(financialSummary.totalLdbSpent).toLocaleString()} ₭
          </p>
          <div className="flex items-center justify-between text-[9.5px] text-slate-400 font-bold">
            <span>{i18n.language === 'la' ? 'ຈ່າຍຜ່ານ LDB Trust' : 'LDB Bank Transfer'}</span>
            <span className="text-blue-500 font-mono">
              {financialSummary.grandTotalSpent > 0 ? ((financialSummary.totalLdbSpent / financialSummary.grandTotalSpent) * 100).toFixed(0) : 0}%
            </span>
          </div>
        </div>

      </div>

      {/* ================= 3. EXECUTIVE FINANCIAL REPORT (ROI, Margin, Revenue, Net Profit) ================= */}
      <div className="bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-white/10 pb-4">
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span>{i18n.language === 'la' ? 'ບົດລາຍງານປະສິດທິພາບການເງິນ (Financial Performance Report)' : 'Financial KPIs & Performance'}</span>
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {i18n.language === 'la' 
                ? 'ຄິດໄລ່ຍອດຂາຍ, ຕົ້ນທຶນວັດຖຸດິບ (Purchasing), ຄ່າໃຊ້ຈ່າຍບໍລິຫານ ແລະ ກຳໄລສຸດທິ' 
                : 'Live Profitability, Gross Margin, and Estimated ROI Analytics'}
            </p>
          </div>

          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-mono font-black w-fit">
            {timeframeMode === 'month' ? '📅 Monthly KPI' : '🌐 All-Time KPI'}
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
              {Math.round(financialSummary.totalRevenue).toLocaleString()} ₭
            </p>
            <p className="text-[9px] text-slate-400 font-medium">Recorded from Sales</p>
          </div>

          {/* Purchasing (COGS) */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 space-y-1">
            <span className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
              {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບ (Purchasing)' : 'COGS / Materials'}
            </span>
            <p className="text-lg font-black font-mono text-red-500 dark:text-red-400">
              {Math.round(financialSummary.totalPurchasing).toLocaleString()} ₭
            </p>
            <p className="text-[9px] text-slate-400 font-medium">Raw Material Purchases</p>
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
              {Math.round(financialSummary.netProfit).toLocaleString()} ₭
            </p>
            <p className="text-[9px] opacity-80 font-medium">After all OPEX & Purchasing</p>
          </div>

          {/* Estimated ROI */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 space-y-1">
            <span className="text-[9.5px] font-black uppercase tracking-wider block">
              {i18n.language === 'la' ? 'ຜົນຕອບແທນ ROI (Est. ROI)' : 'Estimated ROI'}
            </span>
            <p className="text-lg font-black font-mono">
              {financialSummary.estimatedROI.toFixed(1)}%
            </p>
            <p className="text-[9px] opacity-80 font-medium">Return on Total Cost Invested</p>
          </div>

        </div>
      </div>

      <ApprovalModal 
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        onApprove={executeApprovedAction}
        actionType={approvalType || ''}
        actionData={pendingAction && approvalType === 'delete' ? {
          id: pendingAction,
          item: products.find(p => p.id === supplierPrices.find(sp => sp.id === pendingAction)?.productId)?.name,
          supplier: supplierPrices.find(sp => sp.id === pendingAction)?.supplier,
          date: supplierPrices.find(sp => sp.id === pendingAction)?.date
        } : null}
      />

      {/* ================= 4. MAIN ENTRY FORM (LEFT) & ACTIVE FEED (RIGHT) ================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* LEFT: FLEXIBLE ENTRY FORM (Single Item OR Multi-Item Batch) */}
        <div className="xl:col-span-5 space-y-6">
          <div className="high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
            
            {/* Header + Mode Toggle Switch */}
            <div className="flex justify-between items-start border-b border-slate-100 dark:border-white/10 pb-4">
              <div>
                <span className="px-2.5 py-1 bg-primary/10 dark:bg-blue-400/20 text-primary dark:text-blue-300 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {entryMode === 'batch' ? 'MULTI-ITEM BILL' : 'SINGLE ENTRY'}
                </span>
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mt-1">
                  <Receipt className="w-4 h-4 text-emerald-500" />
                  <span>{i18n.language === 'la' ? 'ບັນທຶກລາຍຈ່າຍ / ໃບບິນ' : 'Record Procurement & Expense'}</span>
                </h3>
              </div>

              {/* SWITCH ENTRY MODE: Single vs Multi-Item */}
              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-2xl border border-slate-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setEntryMode('batch')}
                  className={`px-3 py-1 text-[10px] font-black uppercase rounded-xl transition-all cursor-pointer ${
                    entryMode === 'batch' 
                      ? 'bg-[#052659] text-white shadow-xs' 
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  {i18n.language === 'la' ? 'ຫຼາຍລາຍການ' : 'Multi-Item'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntryMode('single');
                    if (billItems.length > 1) {
                      setBillItems([billItems[0]]);
                    }
                  }}
                  className={`px-3 py-1 text-[10px] font-black uppercase rounded-xl transition-all cursor-pointer ${
                    entryMode === 'single' 
                      ? 'bg-[#052659] text-white shadow-xs' 
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  {i18n.language === 'la' ? 'ລາຍການດ່ຽວ' : 'Single'}
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveBillBatch} className="space-y-4">
              
              {/* Row: Date, Time & Bill No */}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400">
                    {i18n.language === 'la' ? 'ວັນທີ (Date)' : 'Date'}
                  </label>
                  <input 
                    type="date"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold font-mono outline-none text-slate-800 dark:text-white"
                    value={billDate}
                    onChange={e => setBillDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400">
                    {i18n.language === 'la' ? 'ເວລາ (Time)' : 'Time'}
                  </label>
                  <input 
                    type="time"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold font-mono outline-none text-slate-800 dark:text-white"
                    value={billTime}
                    onChange={e => setBillTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Bill No. (Auto)
                  </label>
                  <div className="w-full h-10 px-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-mono font-black flex items-center justify-center">
                    {generatedBillNo}
                  </div>
                </div>
              </div>

              {/* Row: Supplier, Category & Payment Method */}
              <div className="grid grid-cols-3 gap-2">
                
                {/* 1. Supplier */}
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400">
                    {i18n.language === 'la' ? 'ຜູ້ສະໜອງ' : 'Supplier'}
                  </label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
                    value={supplier}
                    onChange={e => setSupplier(e.target.value)}
                    required
                  >
                    <option value="CHANHOM">CHANHOM (CH)</option>
                    <option value="LATDA">LATDA (LD)</option>
                    <option value="HEAVENLY">HEAVENLY (HV)</option>
                    <option value="DMART">DMART (DM)</option>
                    <option value="MARRY ANN">MARRY ANN (MA)</option>
                    <option value="OTHER">Other (OT)</option>
                  </select>
                </div>

                {/* 2. Category */}
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Tag className="w-3 h-3 text-emerald-500" />
                    <span>{i18n.language === 'la' ? 'ປະເພດລາຍການ' : 'Category'}</span>
                  </label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
                    value={category}
                    onChange={e => setCategory(e.target.value as ExpenseCategory)}
                    required
                  >
                    <option value="purchasing">🛒 Purchasing (ວັດຖຸດິບ)</option>
                    <option value="rental">🏠 Rental (ຄ່າເຊົ່າ)</option>
                    <option value="salary">👥 Salary (ເງິນເດືອນ)</option>
                    <option value="operation">⚙️ Operation (ດຳເນີນງານ)</option>
                    <option value="admin">💼 Admin (ບໍລິຫານ)</option>
                    <option value="sales">📈 Sales (ຍອດຂາຍ/ລາຍຮັບ)</option>
                    <option value="other">📦 Other (ອື່ນໆ)</option>
                  </select>
                </div>

                {/* 3. Payment Method */}
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Wallet className="w-3 h-3 text-blue-500" />
                    <span>{i18n.language === 'la' ? 'ຊ່ອງທາງຈ່າຍ' : 'Paid Via'}</span>
                  </label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
                    required
                  >
                    <option value="Cash">💵 Cash (ເງິນສົດ)</option>
                    <option value="Onepay">📱 Onepay (BCEL)</option>
                    <option value="LDB">🏦 LDB (ທະນາຄານ)</option>
                  </select>
                </div>

              </div>

              {/* Currency & Exchange Rate */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Currency
                  </label>
                  <select 
                    className="w-full h-10 px-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                    value={currency}
                    onChange={e => {
                      const c = e.target.value;
                      setCurrency(c);
                      if (c === 'LAK') setExchangeRate(1);
                    }}
                  >
                    <option value="LAK">LAK (₭)</option>
                    <option value="THB">THB (฿)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Exchange Rate to LAK
                  </label>
                  <input 
                    type="number"
                    step="any"
                    disabled={currency === 'LAK'}
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none text-slate-800 dark:text-white disabled:opacity-30"
                    value={currency === 'LAK' ? 1 : exchangeRate}
                    onChange={e => setExchangeRate(parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>

              {/* 🖼️ RECEIPT IMAGE UPLOAD (WITH DRAG & DROP & CTRL+V PASTE SUPPORT) */}
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`space-y-2 p-3.5 rounded-2xl border-2 border-dashed transition-all ${
                  isDragging 
                    ? 'border-emerald-500 bg-emerald-500/10 scale-[1.01]' 
                    : 'border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-[#052659]/50 hover:border-slate-400'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="text-[9.5px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                    <span>{i18n.language === 'la' ? 'ຮູບໃບບິນແນບ (Drop & Ctrl+V Paste)' : 'Receipt Image (Drop or Ctrl+V)'}</span>
                  </span>
                  {billImageBase64 && (
                    <button
                      type="button"
                      onClick={() => setBillImageBase64('')}
                      className="text-[9px] font-black text-red-500 hover:underline uppercase"
                    >
                      {i18n.language === 'la' ? 'ລົບຮູບ' : 'Remove'}
                    </button>
                  )}
                </div>

                {billImageBase64 ? (
                  <div className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 max-h-36 bg-black/10 flex items-center justify-center">
                    <img src={billImageBase64} alt="Receipt" className="w-full h-36 object-cover" />
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(billImageBase64)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-4 h-4" />
                      <span>{i18n.language === 'la' ? 'ເບິ່ງຮູບເຕັມ' : 'View Full Image'}</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <input 
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      onChange={handleManualFileInput}
                      className="hidden"
                      id="supplier-bill-upload"
                    />
                    <label 
                      htmlFor="supplier-bill-upload"
                      className="w-full py-3.5 px-3 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-500 dark:text-slate-400"
                    >
                      <Upload className={`w-5 h-5 ${isDragging ? 'text-emerald-500 animate-bounce' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        {isDragging 
                          ? (i18n.language === 'la' ? 'ປ່ອຍຮູບໃສ່ບ່ອນນີ້ເລີຍ' : 'Drop image here now')
                          : (i18n.language === 'la' ? 'ຄລິກເລືອກຮູບ ຫຼື ລາກຮູບມາໃສ່' : 'Click to upload or Drag & Drop photo')}
                      </span>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        {i18n.language === 'la' ? '📋 ຫຼື ກັອບປີ້ແລ້ວກົດ Ctrl + V ວາງໄດ້ເລີຍ' : '📋 Or paste image directly with Ctrl + V'}
                      </p>
                    </label>
                  </div>
                )}
              </div>

              {/* Items List (Single or Multi-item) */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-1.5">
                    <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                    <span>{entryMode === 'batch' ? `ລາຍການສິນຄ້າ (${billItems.length})` : 'ລາຍການສິນຄ້າ (Single Item)'}</span>
                  </span>
                  
                  {entryMode === 'batch' && (
                    <button
                      type="button"
                      onClick={addNewItemRow}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-[9.5px] font-black uppercase transition-all cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{i18n.language === 'la' ? 'ເພີ່ມລາຍການ' : 'Add Item'}</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {billItems.map((item, index) => {
                    const selectedProd = products.find(p => p.id === item.productId);

                    return (
                      <div 
                        key={item.id} 
                        className="p-3.5 rounded-2xl bg-slate-50/80 dark:bg-[#052659]/60 border border-slate-200/80 dark:border-white/10 space-y-2.5"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[9.5px] font-black uppercase px-2 py-0.5 bg-white dark:bg-white/10 text-slate-600 dark:text-slate-300 rounded-md font-mono">
                            #{index + 1}
                          </span>

                          {billItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItemRow(index)}
                              className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Product Search */}
                        <div className="space-y-1 relative">
                          <input 
                            type="text"
                            required
                            className={`w-full h-10 px-3 pr-8 rounded-xl bg-white dark:bg-[#073069] border text-xs font-bold outline-none ${
                              !item.productId && item.productSearch ? 'border-amber-400' : 'border-slate-200 dark:border-white/10 text-slate-800 dark:text-white'
                            }`}
                            placeholder={t('search_params') + "..."}
                            value={item.isDropdownOpen ? item.productSearch : (selectedProd?.name || item.productSearch)}
                            onFocus={() => {
                              if (selectedProd && !item.productSearch) updateItemRow(index, { productSearch: selectedProd.name });
                              updateItemRow(index, { isDropdownOpen: true });
                            }}
                            onBlur={() => setTimeout(() => updateItemRow(index, { isDropdownOpen: false }), 250)}
                            onChange={(e) => updateItemRow(index, { productSearch: e.target.value, isDropdownOpen: true, productId: '' })}
                          />
                          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />

                          {item.isDropdownOpen && (
                            <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-44 overflow-y-auto">
                              {products
                                .filter(p => !item.productSearch || p.name.toLowerCase().includes(item.productSearch.toLowerCase()))
                                .map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left p-2.5 hover:bg-slate-100 dark:hover:bg-white/10 border-b border-slate-50 dark:border-white/5 flex justify-between items-center"
                                    onClick={() => {
                                      updateItemRow(index, {
                                        productId: p.id,
                                        productSearch: p.name,
                                        unit: p.unit || item.unit,
                                        quantityPerUnit: p.packSize || 1,
                                        isDropdownOpen: false
                                      });
                                    }}
                                  >
                                    <span className="text-xs font-bold text-slate-800 dark:text-white">{p.name}</span>
                                    <span className="text-[9px] text-slate-400 font-bold uppercase">{p.unit || 'UNIT'}</span>
                                  </button>
                              ))}

                              {item.productSearch && !products.some(p => p.name.toLowerCase() === item.productSearch.toLowerCase()) && (
                                <button
                                  type="button"
                                  className="w-full text-left p-2.5 bg-primary/5 text-primary text-xs font-bold uppercase"
                                  onClick={() => addUnlistedProductForItem(item.productSearch, index)}
                                >
                                  + Add Custom "{item.productSearch}"
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Price Mode Toggle */}
                        <div className="grid grid-cols-2 gap-1.5 bg-slate-200/50 dark:bg-black/20 p-1 rounded-xl">
                          <button
                            type="button"
                            onClick={() => updateItemRow(index, { priceMode: 'total' })}
                            className={`py-1 rounded-lg text-[9.5px] font-black ${item.priceMode === 'total' ? 'bg-[#052659] text-white' : 'text-slate-500'}`}
                          >
                            Total Price
                          </button>
                          <button
                            type="button"
                            onClick={() => updateItemRow(index, { priceMode: 'per_pack' })}
                            className={`py-1 rounded-lg text-[9.5px] font-black ${item.priceMode === 'per_pack' ? 'bg-[#052659] text-white' : 'text-slate-500'}`}
                          >
                            Per Pack
                          </button>
                        </div>

                        {/* Price, Qty & Unit */}
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-5">
                            <input 
                              type="text"
                              required
                              placeholder="Price"
                              className="w-full h-9 px-2.5 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-slate-800 dark:text-white"
                              value={item.displayPrice}
                              onChange={e => handleItemPriceChange(index, e.target.value)}
                            />
                          </div>

                          <div className="col-span-3">
                            <input 
                              type="number"
                              min="1"
                              step="any"
                              required
                              placeholder="Qty"
                              className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-center text-slate-800 dark:text-white"
                              value={item.quantity || ''}
                              onChange={e => updateItemRow(index, { quantity: parseFloat(e.target.value) || 1 })}
                            />
                          </div>

                          <div className="col-span-4">
                            <select 
                              className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-[9.5px] font-black uppercase text-slate-800 dark:text-white"
                              value={item.unit}
                              onChange={e => updateItemRow(index, { unit: e.target.value })}
                            >
                              <option value="UNIT">UNIT</option>
                              <option value="ml">ml</option>
                              <option value="g">g</option>
                              <option value="pcs">pcs</option>
                              <option value="psc">psc</option>
                              <option value="BOX">BOX</option>
                              <option value="PACK">PACK</option>
                              <option value="KG">KG</option>
                              <option value="BAG">BAG</option>
                            </select>
                          </div>
                        </div>

                        <input 
                          type="text"
                          placeholder="Item remark / memo..."
                          className="w-full h-8 px-2.5 rounded-lg bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-[10px] text-slate-800 dark:text-white"
                          value={item.remark}
                          onChange={e => updateItemRow(index, { remark: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Total Summary */}
              <div className="p-3.5 bg-[#052659] text-white rounded-2xl flex justify-between items-center shadow-md">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#5483B3]">
                    Grand Total ({currency})
                  </p>
                  <p className="text-lg font-black font-mono">
                    {Math.round(grandTotalLAK).toLocaleString()} ₭
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[9px] font-mono px-2 py-0.5 bg-white/10 rounded-md">
                    {paymentMethod} • {category}
                  </span>
                </div>
              </div>

              {/* Save Button */}
              <button 
                type="submit" 
                disabled={saveLoading}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {saveLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{saveLoading ? 'SAVING...' : `ບັນທຶກລາຍຈ່າຍ (${generatedBillNo})`}</span>
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT: PRICING & PROCUREMENT INDEX FEED */}
        <div className="xl:col-span-7 space-y-6">

          {/* Quick Chart */}
          <div className="high-density-card p-0 flex flex-col overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            <div className="p-3.5 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex justify-between items-center">
              <h4 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
                <span>ດັດຊະນີລາຄາ 10 ລາຍການລ່າສຸດ (Recent Pricing Feed)</span>
              </h4>
            </div>
            <div className="p-4 h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lastTenPrices}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" opacity={0.5} />
                  <XAxis dataKey="supplier" tick={{fontSize: 9, fontWeight: 700}} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#052659', borderRadius: '12px', fontSize: '11px', fontWeight: 800, color: '#fff' }}
                    formatter={(val: number) => [`${val.toLocaleString()} ₭`, 'Total LAK']}
                  />
                  <Bar dataKey="totalLAK" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Records Table */}
          <div className="high-density-card p-0 flex flex-col min-h-[500px] overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            
            {/* Header controls */}
            <div className="p-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex flex-wrap justify-between items-center gap-3 sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">
                  {t('active_pricing_index')}
                </h3>
                <button 
                  onClick={handleExport}
                  className="flex items-center gap-1 text-[9px] font-black uppercase text-blue-500 hover:text-blue-600 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Excel
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 border border-slate-200 dark:border-white/10 p-1 bg-white dark:bg-slate-800 rounded-xl">
                  <input 
                    type="date" 
                    value={selectedFilterDate}
                    onChange={e => setSelectedFilterDate(e.target.value)}
                    className="text-[10px] font-bold font-mono py-0.5 px-1 outline-none bg-transparent text-slate-800 dark:text-white"
                  />
                  {selectedFilterDate && (
                    <button 
                      type="button"
                      onClick={() => setSelectedFilterDate('')}
                      className="px-1.5 py-0.5 text-[8px] font-black uppercase bg-red-50 text-red-500 rounded-md"
                    >
                      All
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Search product, #bill, category..." 
                    className="text-[10px] font-bold py-1.5 pl-7 pr-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-1 focus:ring-primary w-44 shadow-xs"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                  <Search className="absolute left-2.5 top-2.5 w-3 h-3 text-slate-400" />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-blue-200/40 bg-slate-100/50 dark:bg-white/5">
                  <tr>
                    <th className="p-3.5">Bill No / Date</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">Item Name</th>
                    <th className="p-3.5">Paid Via</th>
                    <th className="p-3.5">Valuation (LAK)</th>
                    <th className="p-3.5 text-center">Receipt</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-xs">
                  {sortedSupplierPrices
                    .filter(p => {
                      const prodName = products.find(prod => prod.id === p.productId)?.name || '';
                      const billNumber = p.billNo || '';
                      const supplierName = p.supplier || '';
                      const catName = p.category || '';
                      const matchesSearch = 
                        prodName.toLowerCase().includes(filter.toLowerCase()) || 
                        supplierName.toLowerCase().includes(filter.toLowerCase()) ||
                        billNumber.toLowerCase().includes(filter.toLowerCase()) ||
                        catName.toLowerCase().includes(filter.toLowerCase());
                      const matchesDate = !selectedFilterDate || p.date === selectedFilterDate;
                      return matchesSearch && matchesDate;
                    })
                    .map(price => {
                      const item = products.find(p => p.id === price.productId);
                      const isNew = price.totalPriceLAK !== undefined;
                      const totalLAK = isNew
                        ? Number(price.totalPriceLAK || 0)
                        : (price.currency === 'LAK' ? Number(price.priceOriginal || 0) : Number(price.priceOriginal || 0) * Number(price.exchangeRate || 1)) * (Number(price.quantity) || 1);

                      return (
                        <tr key={price.id} className="hover:bg-slate-50/80 dark:hover:bg-white/5 transition-all group">
                          
                          {/* Bill No & Date */}
                          <td className="p-3.5">
                            {price.billNo && (
                              <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[9px] font-mono font-bold block mb-0.5 w-fit">
                                {price.billNo}
                              </span>
                            )}
                            <span className="text-[11px] font-bold text-slate-800 dark:text-white block">
                              {price.date || format(price.createdAt?.toDate() || new Date(), 'dd/MM/yyyy')}
                            </span>
                          </td>

                          {/* Category Badge */}
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white rounded-md text-[9px] font-black uppercase">
                              {price.category || 'purchasing'}
                            </span>
                          </td>

                          {/* Product / Supplier */}
                          <td className="p-3.5">
                            <span className="text-[11px] font-bold text-slate-800 dark:text-blue-300 block">
                              {item?.name || 'Item'}
                            </span>
                            <span className="text-[9px] text-slate-400 uppercase">
                              {price.supplier} • {price.quantity} {price.unit || 'UNIT'}
                            </span>
                          </td>

                          {/* Payment Method */}
                          <td className="p-3.5">
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${
                              price.paymentMethod === 'Cash' 
                                ? 'bg-emerald-500/10 text-emerald-600' 
                                : price.paymentMethod === 'Onepay' 
                                  ? 'bg-red-500/10 text-red-500' 
                                  : 'bg-blue-500/10 text-blue-500'
                            }`}>
                              {price.paymentMethod || 'Cash'}
                            </span>
                          </td>

                          {/* Valuation */}
                          <td className="p-3.5">
                            <span className="text-[11px] font-mono font-black text-slate-900 dark:text-white block">
                              {Math.round(totalLAK).toLocaleString()} ₭
                            </span>
                          </td>

                          {/* Receipt */}
                          <td className="p-3.5 text-center">
                            {price.billImageUrl ? (
                              <button
                                type="button"
                                onClick={() => setPreviewImageUrl(price.billImageUrl)}
                                className="p-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg cursor-pointer"
                                title="View Receipt"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>

                          {/* Action */}
                          <td className="p-3.5 text-right">
                            <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => {
                                  setEditingPriceId(price.id);
                                  setEditPriceData({
                                    ...price,
                                    date: price.date || format(new Date(), 'yyyy-MM-dd'),
                                    unit: price.unit || item?.unit || 'UNIT'
                                  });
                                }}
                                className="p-1.5 text-slate-400 hover:text-blue-500"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => {
                                  setApprovalType('delete');
                                  setPendingAction(price.id);
                                  setShowApprovalModal(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-red-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

      {/* ================= RECEIPT PREVIEW MODAL ================= */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col space-y-4 max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-500" />
                <span>Attached Receipt View</span>
              </h4>
              <button type="button" onClick={() => setPreviewImageUrl(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-2xl bg-black/5 flex items-center justify-center p-2">
              <img src={previewImageUrl} alt="Receipt Preview" className="max-h-[70vh] w-auto object-contain rounded-xl" />
            </div>
          </div>
        </div>
      )}

      {/* ================= PRODUCT MANAGER MODAL ================= */}
      {showProductManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-black text-slate-800 dark:text-white uppercase">Manage Items</h3>
                <button 
                  type="button"
                  onClick={() => setShowMergeModal(true)}
                  className="mt-1 text-[9px] font-black text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-full"
                >
                  🔄 Merge Duplicates
                </button>
              </div>
              <button type="button" onClick={() => setShowProductManager(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {products.map(p => (
                <div key={p.id} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex items-center justify-between group">
                  <div className="flex-1 mr-2">
                    {editingProduct?.id === p.id ? (
                      <div className="flex gap-2">
                        <input 
                          className="flex-1 h-8 px-2 rounded-lg bg-white dark:bg-[#073069] border text-xs"
                          value={editProductName}
                          onChange={e => setEditProductName(e.target.value)}
                        />
                        <button type="button" onClick={() => handleUpdateProductName(p.id)} className="p-1.5 bg-emerald-500 text-white rounded-lg">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => setEditingProduct(null)} className="p-1.5 bg-slate-200 dark:bg-white/10 rounded-lg">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{p.name}</p>
                        <p className="text-[9px] text-slate-400 uppercase">{p.unit || 'UNIT'}</p>
                      </div>
                    )}
                  </div>
                  {editingProduct?.id !== p.id && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button onClick={() => { setEditingProduct(p); setEditProductName(p.name); setEditProductUnit(p.unit || ''); }} className="p-1.5 text-blue-500">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="p-1.5 text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= MERGE DUPLICATES MODAL ================= */}
      {showMergeModal && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/10 space-y-3">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-2">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">Merge Duplicates</h3>
              <button type="button" onClick={() => setShowMergeModal(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400">1. Old Item (To Delete)</label>
                <select className="w-full p-2 rounded-xl border text-xs" value={mergeSourceId} onChange={e => setMergeSourceId(e.target.value)}>
                  <option value="">-- Select --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400">2. Target Item (To Keep)</label>
                <select className="w-full p-2 rounded-xl border text-xs" value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)}>
                  <option value="">-- Select --</option>
                  {products.filter(p => p.id !== mergeSourceId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400">Multiplier</label>
                <input type="number" step="any" className="w-full p-2 rounded-xl border text-xs font-mono" value={mergeMultiplier} onChange={e => setMergeMultiplier(parseFloat(e.target.value) || 1)} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowMergeModal(false)} className="flex-1 py-2 bg-slate-100 dark:bg-white/10 rounded-xl text-xs font-bold">Cancel</button>
              <button type="button" disabled={isMerging || !mergeSourceId || !mergeTargetId} onClick={handleMergeProducts} className="flex-1 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold">Merge</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= EDIT SINGLE PRICE MODAL ================= */}
      {editingPriceId && editPriceData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/10 space-y-3">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-2">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">Modify Entry</h3>
              <button type="button" onClick={() => { setEditingPriceId(null); setEditPriceData(null); }}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400">Bill No</label>
                <input className="w-full p-2 rounded-xl border text-xs font-mono" value={editPriceData.billNo || ''} onChange={e => setEditPriceData({...editPriceData, billNo: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400">Category</label>
                  <select className="w-full p-2 rounded-xl border text-xs" value={editPriceData.category || 'purchasing'} onChange={e => setEditPriceData({...editPriceData, category: e.target.value})}>
                    <option value="purchasing">Purchasing</option>
                    <option value="rental">Rental</option>
                    <option value="salary">Salary</option>
                    <option value="operation">Operation</option>
                    <option value="admin">Admin</option>
                    <option value="sales">Sales</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400">Paid Via</label>
                  <select className="w-full p-2 rounded-xl border text-xs" value={editPriceData.paymentMethod || 'Cash'} onChange={e => setEditPriceData({...editPriceData, paymentMethod: e.target.value})}>
                    <option value="Cash">Cash</option>
                    <option value="Onepay">Onepay</option>
                    <option value="LDB">LDB</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400">Price</label>
                  <input type="number" step="any" className="w-full p-2 rounded-xl border text-xs font-mono" value={editPriceData.priceOriginal || 0} onChange={e => setEditPriceData({...editPriceData, priceOriginal: parseFloat(e.target.value) || 0})} />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400">Quantity</label>
                  <input type="number" step="any" className="w-full p-2 rounded-xl border text-xs font-mono" value={editPriceData.quantity || 1} onChange={e => setEditPriceData({...editPriceData, quantity: parseFloat(e.target.value) || 1})} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => { setEditingPriceId(null); setEditPriceData(null); }} className="flex-1 py-2 bg-slate-100 dark:bg-white/10 rounded-xl text-xs font-bold">Cancel</button>
              <button type="button" disabled={saveLoading} onClick={handleUpdatePrice} className="flex-1 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold">Update</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
