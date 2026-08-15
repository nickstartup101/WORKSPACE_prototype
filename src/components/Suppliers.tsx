import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, updateDoc, serverTimestamp 
} from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Plus, Trash2, Edit3, Save, X, Search, Download, 
  List, Check, Receipt, ShoppingBag, Layers, 
  Image as ImageIcon, Upload, Eye, Wallet, CreditCard,
  Building2, TrendingUp, Calendar, 
  ArrowUpRight, ArrowDownRight, ShoppingCart,
  Clock, Hash, HelpCircle
} from 'lucide-react';
import { format, isSameMonth, parseISO, subMonths, getDate, getDaysInMonth } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';
import { COMMON_RESOURCES } from '../constants';
import ApprovalModal from './ApprovalModal';

// Supplier Code abbreviations
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
  const [selectedFilterDate, setSelectedFilterDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  // Mode Switcher: 'batch' vs 'single'
  const [entryMode, setEntryMode] = useState<'batch' | 'single'>('batch');

  // Product Manager States
  const [showProductManager, setShowProductManager] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editProductName, setEditProductName] = useState('');
  const [editProductUnit, setEditProductUnit] = useState('');
  const [editProductIsDurable, setEditProductIsDurable] = useState(false);
  const [editProductBoxSize, setEditProductBoxSize] = useState<number>(12);

  // Edit Modal State
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceData, setEditPriceData] = useState<any>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Form States
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

  // Items in active bill
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

  // Approval Modal State
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'create' | 'delete' | null>(null);
  const [pendingAction, setPendingAction] = useState<any>(null);

  // Listen to Firestore
  useEffect(() => {
    const qP = query(collection(db, 'products'), orderBy('name'));
    const unsubscribeP = onSnapshot(qP, (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    const qS = query(collection(db, 'supplierPrices'));
    const unsubscribeS = onSnapshot(qS, (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'supplierPrices'));

    return () => {
      unsubscribeP();
      unsubscribeS();
    };
  }, []);

  // 🌟 AUTOMATIC BILL SEQUENCE (SEQ) CALCULATION FOR SAME DATE + SAME SUPPLIER
  const generatedBillNo = useMemo(() => {
    try {
      const parts = billDate.split('-');
      if (parts.length === 3) {
        const ddmmyyyy = `${parts[2]}${parts[1]}${parts[0]}`;
        const code = SUPPLIER_CODES[supplier] || (supplier ? supplier.slice(0, 2).toUpperCase() : 'OT');
        const basePrefix = `#${ddmmyyyy}${code}`;

        // Find existing distinct bills for this date and supplier
        const existingBills = new Set<string>();
        supplierPrices.forEach(p => {
          if (p.date === billDate && p.supplier === supplier && p.billNo) {
            existingBills.add(p.billNo);
          }
        });

        // Auto assign next sequence
        const seq = existingBills.size + 1;
        return `${basePrefix}-${seq}`;
      }
    } catch {
      // fallback
    }
    return `#${format(new Date(), 'ddMMyyyy')}${SUPPLIER_CODES[supplier] || 'OT'}-1`;
  }, [billDate, supplier, supplierPrices]);

  // Sort supplierPrices by date descending
  const sortedSupplierPrices = useMemo(() => {
    return [...supplierPrices].sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const timeA = a.time || '';
      const timeB = b.time || '';
      return timeB.localeCompare(timeA);
    });
  }, [supplierPrices]);

  // ================= 📊 COGS THIS MONTH VS LAST MONTH COMPARISON =================
  const cogsAnalytics = useMemo(() => {
    const now = new Date();
    const prevMonth = subMonths(now, 1);

    let currentMonthCOGS = 0;
    let previousMonthCOGS = 0;

    const daysInCurrentMonth = getDaysInMonth(now);
    const dailyMap: { [day: number]: { day: string; thisMonth: number; lastMonth: number } } = {};

    for (let d = 1; d <= 31; d++) {
      dailyMap[d] = {
        day: d < 10 ? `0${d}` : `${d}`,
        thisMonth: 0,
        lastMonth: 0
      };
    }

    supplierPrices.forEach(p => {
      if (!p.date) return;
      try {
        const d = parseISO(p.date);
        const dayNum = getDate(d);
        const cat = (p.category || 'purchasing').toLowerCase();

        const isNew = p.totalPriceLAK !== undefined;
        const amount = isNew
          ? Number(p.totalPriceLAK || 0)
          : (p.currency === 'LAK' ? Number(p.priceOriginal || 0) : Number(p.priceOriginal || 0) * Number(p.exchangeRate || 1)) * (Number(p.quantity) || 1);

        const isPurchasing = cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້') || cat === 'purchasing';

        if (isSameMonth(d, now) && isPurchasing) {
          currentMonthCOGS += amount;
          if (dailyMap[dayNum]) {
            dailyMap[dayNum].thisMonth += amount;
          }
        }

        if (isSameMonth(d, prevMonth) && isPurchasing) {
          previousMonthCOGS += amount;
          if (dailyMap[dayNum]) {
            dailyMap[dayNum].lastMonth += amount;
          }
        }
      } catch {}
    });

    const diffAmount = currentMonthCOGS - previousMonthCOGS;
    const percentChange = previousMonthCOGS > 0 ? (diffAmount / previousMonthCOGS) * 100 : 0;
    const comparisonChartData = Object.values(dailyMap).slice(0, daysInCurrentMonth);

    return {
      currentMonthCOGS,
      previousMonthCOGS,
      diffAmount,
      percentChange,
      comparisonChartData,
      currentMonthName: format(now, 'MMMM yyyy'),
      prevMonthName: format(prevMonth, 'MMMM yyyy')
    };
  }, [supplierPrices]);

  // Handle Bill Image Upload & Compression
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert(i18n.language === 'la' ? 'ຮູບພາບມີຂະໜາດໃຫຍ່ເກີນ 5MB' : 'File is larger than 5MB.');
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

  const grandTotalLAK = useMemo(() => {
    const rate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);
    return billItems.reduce((acc, item) => {
      const orig = Number(item.priceOriginal) || 0;
      const qty = Number(item.quantity) || 1;
      const totalOrig = item.priceMode === 'total' ? orig : orig * qty;
      return acc + (totalOrig * rate);
    }, 0);
  }, [billItems, currency, exchangeRate]);

  // Submit the Bill
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
          ? `ລາຍການທີ ${i + 1} ຍັງບໍ່ໄດ້ເລືອກສິນຄ້າ` 
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
        ? `ບັນທຶກເລກບິນ ${generatedBillNo} ສຳເລັດແລ້ວ!` 
        : `Successfully saved Bill ${generatedBillNo}!`);

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
    utils.book_append_sheet(workbook, worksheet, 'Suppliers COGS Report');
    writeFile(workbook, `suppliers_cogs_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-6">
      
      {/* ================= 1. TOP HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              {i18n.language === 'la' ? 'ລະບົບຈັດຊື້ & ຕົ້ນທຶນວັດຖຸດິບ (COGS Center)' : 'Procurement & COGS Management'}
            </h2>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {i18n.language === 'la' 
                ? 'ຕິດຕາມຕົ້ນທຶນວັດຖຸດິບ • ປຽບທຽບເດືອນນີ້ vs ເດືອນກ່ອນ • ບັນທຶກບິນຈັດຊື້' 
                : 'Raw Material Costs Tracker & Monthly Comparison'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            type="button" 
            onClick={() => setShowProductManager(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white font-black text-xs uppercase rounded-xl transition-all"
          >
            <List className="w-4 h-4 text-primary" />
            <span>{i18n.language === 'la' ? 'ຈັດການສິນຄ້າ' : 'Catalog Items'}</span>
          </button>
        </div>
      </div>

      {/* ================= 2. COGS THIS MONTH VS LAST MONTH COMPARISON ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* LEFT: COGS CURRENT MONTH SUMMARY (5 Cols) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-[#052659] via-[#073069] to-[#0b3c7e] text-white p-7 rounded-[2.5rem] shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-400/10 rounded-full -mr-16 -mt-16 blur-2xl pointer-events-none"></div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7eb3ea]">
                {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບເດືອນປັດຈຸບັນ (COGS)' : 'Current Month Material COGS'}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-white/10 text-[9px] font-mono font-bold">
                {cogsAnalytics.currentMonthName}
              </span>
            </div>

            <div>
              <h3 className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-white">
                {Math.round(cogsAnalytics.currentMonthCOGS).toLocaleString()}
                <span className="text-lg opacity-60 ml-2 font-sans font-bold">₭</span>
              </h3>
            </div>

            {/* Change Badge */}
            <div className="flex items-center gap-2 pt-1">
              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-black flex items-center gap-1 ${
                cogsAnalytics.diffAmount > 0 
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' 
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}>
                {cogsAnalytics.diffAmount > 0 ? (
                  <>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    +{Math.abs(cogsAnalytics.percentChange).toFixed(1)}% ({i18n.language === 'la' ? 'ຕົ້ນທຶນເພີ່ມຂຶ້ນ' : 'Increase'})
                  </>
                ) : (
                  <>
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    -{Math.abs(cogsAnalytics.percentChange).toFixed(1)}% ({i18n.language === 'la' ? 'ຕົ້ນທຶນຫຼຸດລົງ' : 'Saved'})
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Reference row */}
          <div className="pt-5 border-t border-white/10 mt-6 grid grid-cols-2 gap-4">
            <div>
              <span className="text-[9.5px] font-black uppercase text-slate-300">
                {i18n.language === 'la' ? 'ເດືອນຜ່ານມາ (Last Month)' : 'Previous Month COGS'}
              </span>
              <p className="text-base font-black font-mono text-slate-200 mt-0.5">
                {Math.round(cogsAnalytics.previousMonthCOGS).toLocaleString()} ₭
              </p>
            </div>

            <div>
              <span className="text-[9.5px] font-black uppercase text-slate-300">
                {i18n.language === 'la' ? 'ຜົນຕ່າງ (Net Diff)' : 'Net Difference'}
              </span>
              <p className={`text-base font-black font-mono mt-0.5 ${cogsAnalytics.diffAmount > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                {cogsAnalytics.diffAmount > 0 ? '+' : ''}{Math.round(cogsAnalytics.diffAmount).toLocaleString()} ₭
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT: COGS COMPARISON GRAPH (7 Cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-[#073069] p-6 rounded-[2.5rem] border border-slate-200/70 dark:border-white/10 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-white/10 pb-3">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span>{i18n.language === 'la' ? 'ກຣາຟສົມທຽບຕົ້ນທຶນ (ເດືອນນີ້ VS ເດືອນກ່ອນ)' : 'COGS Comparison: This Month vs Last Month'}</span>
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                {cogsAnalytics.currentMonthName} vs {cogsAnalytics.prevMonthName} (Day 1 - 31)
              </p>
            </div>

            <div className="flex gap-3 text-[9.5px] font-black uppercase">
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> 
                {i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'}
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600"></span> 
                {i18n.language === 'la' ? 'ເດືອນກ່ອນ' : 'Last Month'}
              </span>
            </div>
          </div>

          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cogsAnalytics.comparisonChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="day" tick={{fontSize: 9, fontWeight: 700}} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#052659', borderRadius: '12px', fontSize: '11px', color: '#fff', border: 'none' }}
                  formatter={(val: number) => [`${val.toLocaleString()} ₭`, '']}
                />
                <Bar dataKey="thisMonth" fill="#10b981" radius={[4, 4, 0, 0]} name={i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'} />
                <Bar dataKey="lastMonth" fill="#94a3b8" radius={[4, 4, 0, 0]} name={i18n.language === 'la' ? 'ເດືອນກ່ອນ' : 'Last Month'} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* ================= 3. 🌟 CLEAN 4-SECTION PROCUREMENT CARD (NO OVERLAP + AUTO SEQ) ================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* LEFT: 4-SECTION ENTRY CARD (5 Cols) */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-white dark:bg-[#073069] rounded-[2.5rem] p-6 sm:p-7 border border-slate-200/80 dark:border-white/10 shadow-xl space-y-6">
            
            {/* Header & Mode Switch */}
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-4">
              <div>
                <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {entryMode === 'batch' ? 'BATCH PROCUREMENT' : 'SINGLE ENTRY'}
                </span>
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mt-1">
                  <Receipt className="w-4 h-4 text-emerald-500" />
                  <span>{i18n.language === 'la' ? 'ບັນທຶກບິນຈັດຊື້' : 'New Procurement Bill'}</span>
                </h3>
              </div>

              <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200/80 dark:border-white/10">
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

            <form onSubmit={handleSaveBillBatch} className="space-y-6">
              
              {/* 🏷️ SECTION 1: ຂໍ້ມູນໃບບິນ & ຜູ້ສະໜອງ (FIXED OVERLAP & AUTO SEQ) */}
              <div className="p-4 bg-slate-50/80 dark:bg-black/20 rounded-2xl border border-slate-200/60 dark:border-white/5 space-y-4">
                
                {/* Section Title & Auto Bill No Display */}
                <div className="flex justify-between items-center border-b border-slate-200/60 dark:border-white/5 pb-2.5">
                  <span className="text-[10.5px] font-black uppercase text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] font-black">1</span>
                    <span>{i18n.language === 'la' ? 'ຂໍ້ມູນໃບບິນ & ຜູ້ສະໜອງ' : 'Bill Header & Vendor'}</span>
                  </span>
                  
                  {/* 🌟 Auto Generated Bill No Badge */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                      {generatedBillNo}
                    </span>
                  </div>
                </div>

                {/* 🌟 CLEAN DATE & TIME LAYOUT (NO OVERLAP) */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>{i18n.language === 'la' ? 'ວັນທີຊື້ (Purchase Date)' : 'Purchase Date'}</span>
                    </label>
                    <input 
                      type="date"
                      required
                      className="w-full h-11 px-3.5 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white outline-none"
                      value={billDate}
                      onChange={e => setBillDate(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{i18n.language === 'la' ? 'ເວລາ (Time)' : 'Time'}</span>
                    </label>
                    <input 
                      type="time"
                      required
                      className="w-full h-11 px-3.5 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white outline-none"
                      value={billTime}
                      onChange={e => setBillTime(e.target.value)}
                    />
                  </div>
                </div>

                {/* Supplier Selection */}
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">
                    {i18n.language === 'la' ? 'ຜູ້ສະໜອງສິນຄ້າ (Supplier)' : 'Supplier'}
                  </label>
                  <select 
                    className="w-full h-11 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
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

                {/* Category & Payment Method */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black uppercase text-slate-400">
                      {i18n.language === 'la' ? 'ປະເພດ' : 'Category'}
                    </label>
                    <select 
                      className="w-full h-10 px-2.5 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
                      value={category}
                      onChange={e => setCategory(e.target.value as ExpenseCategory)}
                      required
                    >
                      <option value="purchasing">🛒 Purchasing (COGS)</option>
                      <option value="rental">🏠 Rental (ຄ່າເຊົ່າ)</option>
                      <option value="salary">👥 Salary (ເງິນເດືອນ)</option>
                      <option value="operation">⚙️ Operation (ດຳເນີນງານ)</option>
                      <option value="admin">💼 Admin (ບໍລິຫານ)</option>
                      <option value="other">📦 Other (ອື່ນໆ)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black uppercase text-slate-400">
                      {i18n.language === 'la' ? 'ຊ່ອງທາງຈ່າຍ' : 'Payment'}
                    </label>
                    <select 
                      className="w-full h-10 px-2.5 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black uppercase text-slate-400">Currency</label>
                    <select 
                      className="w-full h-10 px-2.5 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
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
                    <label className="text-[9.5px] font-black uppercase text-slate-400">Exchange Rate</label>
                    <input 
                      type="number"
                      step="any"
                      disabled={currency === 'LAK'}
                      className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-slate-800 dark:text-white disabled:opacity-40"
                      value={currency === 'LAK' ? 1 : exchangeRate}
                      onChange={e => setExchangeRate(parseFloat(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>

              {/* 📸 SECTION 2: ແນບຮູບໃບບິນ (RECEIPT ATTACHMENT) */}
              <div className="p-4 bg-slate-50/80 dark:bg-black/20 rounded-2xl border border-slate-200/60 dark:border-white/5 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-200/60 dark:border-white/5 pb-2">
                  <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[9px] font-black">2</span>
                    <span>{i18n.language === 'la' ? 'ຮູບໃບບິນແນບ (Receipt Photo)' : 'Receipt Photo'}</span>
                  </span>
                  {billImageBase64 && (
                    <button
                      type="button"
                      onClick={() => setBillImageBase64('')}
                      className="text-[9px] font-black text-red-500 hover:underline uppercase"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {billImageBase64 ? (
                  <div className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 max-h-36 bg-black/10 flex items-center justify-center">
                    <img src={billImageBase64} alt="Receipt Preview" className="w-full h-36 object-cover" />
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(billImageBase64)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold"
                    >
                      <Eye className="w-4 h-4" />
                      <span>{i18n.language === 'la' ? 'ເບິ່ງຮູບໃຫຍ່' : 'View Full'}</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <input 
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      id="supplier-bill-upload-box"
                    />
                    <label 
                      htmlFor="supplier-bill-upload-box"
                      className="w-full py-3 px-4 rounded-xl border border-dashed border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center justify-center gap-2 cursor-pointer text-slate-500 dark:text-slate-400 text-xs font-bold"
                    >
                      <Upload className="w-4 h-4 text-blue-500" />
                      <span>{i18n.language === 'la' ? 'ອັບໂຫຼດຮູບໃບບິນ (JPG/PNG)' : 'Upload Receipt Photo'}</span>
                    </label>
                  </div>
                )}
              </div>

              {/* 🛒 SECTION 3: ລາຍການສິນຄ້າໃນບິນ (BILL LINE ITEMS) */}
              <div className="p-4 bg-slate-50/80 dark:bg-black/20 rounded-2xl border border-slate-200/60 dark:border-white/5 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-200/60 dark:border-white/5 pb-2">
                  <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-black">3</span>
                    <span>{entryMode === 'batch' ? `ລາຍການສິນຄ້າ (${billItems.length} ອັນ)` : 'ລາຍການສິນຄ້າ'}</span>
                  </span>
                  
                  {entryMode === 'batch' && (
                    <button
                      type="button"
                      onClick={addNewItemRow}
                      className="flex items-center gap-1 px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-[9.5px] font-black uppercase transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
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
                        className="p-3.5 rounded-2xl bg-white dark:bg-[#073069] border border-slate-200/70 dark:border-white/10 space-y-2.5 shadow-xs"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[9.5px] font-black uppercase px-2 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 rounded-md font-mono">
                            Item #{index + 1}
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
                            className={`w-full h-10 px-3 pr-8 rounded-xl bg-slate-50 dark:bg-black/20 border text-xs font-bold outline-none ${
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
                        <div className="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-black/20 p-1 rounded-xl">
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
                              className="w-full h-9 px-2.5 rounded-xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-slate-800 dark:text-white"
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
                              className="w-full h-9 px-2 rounded-xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-center text-slate-800 dark:text-white"
                              value={item.quantity || ''}
                              onChange={e => updateItemRow(index, { quantity: parseFloat(e.target.value) || 1 })}
                            />
                          </div>

                          <div className="col-span-4">
                            <select 
                              className="w-full h-9 px-2 rounded-xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-[9.5px] font-black uppercase text-slate-800 dark:text-white"
                              value={item.unit}
                              onChange={e => updateItemRow(index, { unit: e.target.value })}
                            >
                              <option value="UNIT">UNIT</option>
                              <option value="ml">ml</option>
                              <option value="g">g</option>
                              <option value="pcs">pcs</option>
                              <option value="BOX">BOX</option>
                              <option value="PACK">PACK</option>
                              <option value="KG">KG</option>
                              <option value="BAG">BAG</option>
                            </select>
                          </div>
                        </div>

                        <input 
                          type="text"
                          placeholder="Item remark / note..."
                          className="w-full h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-[10px] text-slate-800 dark:text-white"
                          value={item.remark}
                          onChange={e => updateItemRow(index, { remark: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 💳 SECTION 4: ສະຫຼຸບຍອດ & ບັນທຶກ (SUMMARY & COMMIT) */}
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-br from-[#052659] to-[#073069] text-white rounded-2xl flex justify-between items-center shadow-lg">
                  <div>
                    <p className="text-[9.5px] font-black uppercase tracking-widest text-[#7eb3ea]">
                      {i18n.language === 'la' ? 'ຍອດລວມທັງໝົດຂອງໃບບິນ' : 'Grand Bill Total (LAK)'}
                    </p>
                    <p className="text-2xl font-black font-mono tracking-tight mt-0.5">
                      {Math.round(grandTotalLAK).toLocaleString()} ₭
                    </p>
                    <p className="text-[9.5px] text-blue-200/70 font-mono mt-0.5">
                      {billItems.length} {billItems.length > 1 ? 'items' : 'item'} • {generatedBillNo}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-mono font-bold px-2.5 py-1 bg-white/10 rounded-lg">
                      {paymentMethod} • {category}
                    </span>
                  </div>
                </div>

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
                  <span>{saveLoading ? 'SAVING...' : `ບັນທຶກບິນຈັດຊື້ (${generatedBillNo})`}</span>
                </button>
              </div>

            </form>
          </div>
        </div>

        {/* RIGHT: PRICING & PROCUREMENT INDEX FEED (7 Cols) */}
        <div className="xl:col-span-7 space-y-6">

          <div className="high-density-card p-0 flex flex-col min-h-[550px] overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            
            <div className="p-4 border-b border-slate-100 dark:border-white/5 flex flex-wrap justify-between items-center gap-3 sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">
                  {t('active_pricing_index')} (COGS Records)
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
                    placeholder="Search item, #bill..." 
                    className="text-[10px] font-bold py-1.5 pl-7 pr-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-1 focus:ring-primary w-44 shadow-xs"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                  <Search className="absolute left-2.5 top-2.5 w-3 h-3 text-slate-400" />
                </div>
              </div>
            </div>

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

      {/* ================= MODALS ================= */}
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

      {/* Product Manager */}
      {showProductManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-black text-slate-800 dark:text-white uppercase">Catalog Items</h3>
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
                          className="flex-1 h-8 px-2 rounded-lg bg-white dark:bg-[#073069] border text-xs font-bold"
                          value={editProductName}
                          onChange={e => setEditProductName(e.target.value)}
                        />
                        <button type="button" onClick={async () => {
                          await updateDoc(doc(db, 'products', p.id), { name: editProductName.trim(), unit: editProductUnit.trim() || 'UNIT' });
                          setEditingProduct(null);
                        }} className="p-1.5 bg-emerald-500 text-white rounded-lg">
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
                      <button onClick={async () => {
                        if (confirm('Delete product?')) await deleteDoc(doc(db, 'products', p.id));
                      }} className="p-1.5 text-red-500">
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

    </div>
  );
}
