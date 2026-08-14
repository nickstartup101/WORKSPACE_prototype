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
  Plus, Trash2, Edit3, Save, X, Search, Clock, Download, 
  BarChart3, List, Check, Receipt, ShoppingBag, Layers, 
  Image as ImageIcon, Upload, Eye, FileText
} from 'lucide-react';
import { format } from 'date-fns';
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

  // --- Bill Entry Form States (Multi-item entry) ---
  const [billDate, setBillDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [billTime, setBillTime] = useState<string>(format(new Date(), 'HH:mm'));
  const [supplier, setSupplier] = useState<string>('CHANHOM');
  const [currency, setCurrency] = useState<string>('LAK');
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [billImageBase64, setBillImageBase64] = useState<string>('');
  const [billRemark, setBillRemark] = useState<string>('');
  const [saveLoading, setSaveLoading] = useState(false);

  // Items list in current active bill
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

  // Merge Products / Duplicates States
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeMultiplier, setMergeMultiplier] = useState(1);
  const [isMerging, setIsMerging] = useState(false);

  // Auto Bill No Generation: # + DDMMYYYY + SupplierCode (e.g. #14082026CH)
  const generatedBillNo = useMemo(() => {
    try {
      const parts = billDate.split('-'); // [yyyy, mm, dd]
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

  // Subscribe to Firestore
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

    return () => {
      unsubscribeP();
      unsubscribeS();
    };
  }, []);

  // Sort supplierPrices by date descending, then time descending
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

  // Latest 10 records for bar chart
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

  // Handle Bill Image Upload & Compression to Base64
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (< 5MB before compression)
    if (file.size > 5 * 1024 * 1024) {
      alert(i18n.language === 'la' ? 'ຮູບພາບມີຂະໜາດໃຫຍ່ເກີນ 5MB, ກະລຸນາເລືອກຮູບໃໝ່' : 'File is larger than 5MB. Please choose a smaller image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        // Compress image using canvas
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

  // Helper functions for Form Item Rows
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

  // Calculate Grand Total of the current Bill
  const grandTotalLAK = useMemo(() => {
    const rate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);
    return billItems.reduce((acc, item) => {
      const orig = Number(item.priceOriginal) || 0;
      const qty = Number(item.quantity) || 1;
      const totalOrig = item.priceMode === 'total' ? orig : orig * qty;
      return acc + (totalOrig * rate);
    }, 0);
  }, [billItems, currency, exchangeRate]);

  // Submit the entire Bill batch
  const handleSaveBillBatch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplier) {
      alert(i18n.language === 'la' ? 'ກະລຸນາເລືອກຜູ້ສະໜອງ' : 'Please select a supplier.');
      return;
    }

    // Validate that all items have a selected productId
    for (let i = 0; i < billItems.length; i++) {
      const item = billItems[i];
      if (!item.productId) {
        alert(i18n.language === 'la' 
          ? `ລາຍການທີ ${i + 1} ຍັງບໍ່ໄດ້ເລືອກສິນຄ້າ. ກະລຸນາເລືອກ ຫຼື ເພີ່ມສິນຄ້າໃໝ່` 
          : `Item #${i + 1} does not have a selected product. Please select or create one.`);
        return;
      }
    }

    try {
      setSaveLoading(true);
      const batchGroupId = `bill_${Date.now()}`;
      const finalRate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);

      // Save each item in the batch linked to the same billNo and bill image
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
        ? `ບັນທຶກໃບບິນເລກທີ ${generatedBillNo} ທັງໝົດ ${billItems.length} ລາຍການສຳເລັດແລ້ວ!` 
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
      if (err.message?.includes("permission-denied")) {
        alert("Permission Denied: You do not have rights to create supplier records.");
      } else {
        alert("Error saving data. Please check connection and try again.");
      }
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
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      alert("Product deleted successfully");
    } catch (err: any) {
      console.error("Delete Error:", err);
      handleFirestoreError(err, OperationType.DELETE, 'products');
    }
  };

  // Merge Duplicates
  const handleMergeProducts = async () => {
    if (!mergeSourceId || !mergeTargetId) {
      alert("Please select both a source product and a target product.");
      return;
    }
    if (mergeSourceId === mergeTargetId) {
      alert("Source and Target cannot be the same product!");
      return;
    }

    const sourceProd = products.find(p => p.id === mergeSourceId);
    const targetProd = products.find(p => p.id === mergeTargetId);
    if (!sourceProd || !targetProd) return;

    if (!confirm(`Merge "${sourceProd.name}" into "${targetProd.name}"?`)) return;

    try {
      setIsMerging(true);
      const priceDocs = supplierPrices.filter(sp => sp.productId === mergeSourceId);
      for (const priceDoc of priceDocs) {
        const newQtyPerUnit = (priceDoc.quantityPerUnit || 1) * mergeMultiplier;
        await updateDoc(doc(db, 'supplierPrices', priceDoc.id), {
          productId: mergeTargetId,
          quantityPerUnit: newQtyPerUnit,
          remark: `${priceDoc.remark || ''} (Merged from ${sourceProd.name})`.trim()
        });
      }
      await deleteDoc(doc(db, 'products', mergeSourceId));
      alert("Successfully merged products!");
      setShowMergeModal(false);
      setMergeSourceId('');
      setMergeTargetId('');
      setMergeMultiplier(1);
    } catch (err: any) {
      console.error(err);
      alert("Error while merging: " + err.message);
    } finally {
      setIsMerging(false);
    }
  };

  // Update single price entry
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

  // Execute approval deletion
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
    const headers = ['Bill No', 'Date', 'Product', 'Supplier', 'Price LAK', 'Total LAK', 'Quantity', 'Unit', 'Remark', 'User'];
    const rows = sortedSupplierPrices.map(p => [
      p.billNo || '-',
      p.date || format(p.createdAt?.toDate() || new Date(), 'yyyy-MM-dd'),
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
    utils.book_append_sheet(workbook, worksheet, 'Suppliers Report');
    writeFile(workbook, `suppliers_bills_report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Real-time Status Header & Bill Code Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-2xl border border-[#052659]/10 dark:border-white/5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-3.5 w-3.5 rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              {i18n.language === 'la' ? 'ລະບົບບັນທຶກໃບບິນ ແລະ ລາຄາຜູ້ສະໜອງ (Multi-Item Bill Registry)' : 'Supplier Multi-Item Bill & Pricing Registry'}
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-300 font-bold uppercase mt-0.5">
              {i18n.language === 'la' 
                ? 'ບັນທຶກຫຼາຍລາຍການໃນບິນດຽວ • ຜູກຮູບໃບບິນອັດຕະໂນມັດ • ສົ່ງຕໍ່ໃຫ້ຝັ່ງ Finance ໄດ້ທັນທີ' 
                : 'Batch item entry linked with receipt image & auto Bill No for Finance sync'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            type="button" 
            onClick={() => setShowProductManager(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-white font-black text-[10px] uppercase rounded-xl transition-all cursor-pointer"
          >
            <List className="w-3.5 h-3.5 text-primary dark:text-blue-400" />
            <span>{i18n.language === 'la' ? 'ຈັດການສິນຄ້າ / Items' : 'Manage Items'}</span>
          </button>
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

      {/* Main Grid: Left = Multi-item Bill Form, Right = Pricing Index Feed */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* ================= BILL ENTRY FORM (LEFT - 5 COLS) ================= */}
        <div className="xl:col-span-5 space-y-6">
          <div className="high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
            
            {/* Bill Header Info */}
            <div className="flex justify-between items-start border-b border-slate-100 dark:border-white/10 pb-4">
              <div>
                <span className="px-2.5 py-1 bg-primary/10 dark:bg-blue-400/20 text-primary dark:text-blue-300 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {i18n.language === 'la' ? 'ໃບບິນໃໝ່' : 'NEW BILL ENTRY'}
                </span>
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mt-1">
                  <Receipt className="w-4 h-4 text-emerald-500" />
                  <span>{i18n.language === 'la' ? 'ບັນທຶກໃບບິນສັ່ງຊື້' : 'Create Procurement Bill'}</span>
                </h3>
              </div>

              {/* Auto Bill No Tag */}
              <div className="text-right">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">
                  Bill No (Auto)
                </span>
                <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-mono font-black tracking-wider inline-block mt-0.5">
                  {generatedBillNo}
                </span>
              </div>
            </div>

            <form onSubmit={handleSaveBillBatch} className="space-y-5">
              
              {/* Row 1: Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    {i18n.language === 'la' ? 'ວັນທີຊື້ (Date)' : 'Date'}
                  </label>
                  <input 
                    type="date"
                    required
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold font-mono outline-none text-slate-800 dark:text-white"
                    value={billDate}
                    onChange={e => setBillDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    {i18n.language === 'la' ? 'ເວລາ (Time)' : 'Time'}
                  </label>
                  <input 
                    type="time"
                    required
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold font-mono outline-none text-slate-800 dark:text-white"
                    value={billTime}
                    onChange={e => setBillTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Supplier & Currency */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    {i18n.language === 'la' ? 'ຜູ້ສະໜອງ (Supplier)' : 'Supplier'}
                  </label>
                  <select 
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
                    value={supplier}
                    onChange={e => setSupplier(e.target.value)}
                    required
                  >
                    <option value="CHANHOM" className="bg-white dark:bg-slate-800">CHANHOM (CH)</option>
                    <option value="LATDA" className="bg-white dark:bg-slate-800">LATDA (LD)</option>
                    <option value="HEAVENLY" className="bg-white dark:bg-slate-800">HEAVENLY (HV)</option>
                    <option value="DMART" className="bg-white dark:bg-slate-800">DMART (DM)</option>
                    <option value="MARRY ANN" className="bg-white dark:bg-slate-800">MARRY ANN (MA)</option>
                    <option value="OTHER" className="bg-white dark:bg-slate-800">Other (OT)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    {i18n.language === 'la' ? 'ສະກຸນເງິນ (Currency)' : 'Currency'}
                  </label>
                  <div className="flex gap-2">
                    <select 
                      className="w-24 h-11 px-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                      value={currency}
                      onChange={e => {
                        const c = e.target.value;
                        setCurrency(c);
                        if (c === 'LAK') setExchangeRate(1);
                      }}
                    >
                      <option value="LAK" className="bg-white dark:bg-slate-800">LAK (₭)</option>
                      <option value="THB" className="bg-white dark:bg-slate-800">THB (฿)</option>
                      <option value="USD" className="bg-white dark:bg-slate-800">USD ($)</option>
                    </select>

                    <input 
                      type="number"
                      step="any"
                      placeholder="Rate"
                      disabled={currency === 'LAK'}
                      className="flex-1 h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none text-slate-800 dark:text-white disabled:opacity-30"
                      value={currency === 'LAK' ? 1 : exchangeRate}
                      onChange={e => setExchangeRate(parseFloat(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>

              {/* Receipt Image Upload (Finance Linked) */}
              <div className="space-y-2 p-3.5 bg-slate-50 dark:bg-[#052659]/50 rounded-2xl border border-dashed border-slate-300 dark:border-white/10">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                    {i18n.language === 'la' ? 'ຮູບໃບບິນ / ໃບຮັບເງິນ (Receipt Image)' : 'Receipt Image (Auto-sync with Finance)'}
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
                    <img 
                      src={billImageBase64} 
                      alt="Receipt Preview" 
                      className="w-full h-36 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(billImageBase64)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold"
                    >
                      <Eye className="w-4 h-4" />
                      <span>{i18n.language === 'la' ? 'ກົດເບິ່ງຮູບໃຫຍ່' : 'View Full Image'}</span>
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
                      id="bill-image-upload"
                    />
                    <label 
                      htmlFor="bill-image-upload"
                      className="w-full py-3 px-4 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center justify-center gap-2 cursor-pointer text-slate-500 dark:text-slate-400 text-xs font-bold"
                    >
                      <Upload className="w-4 h-4 text-emerald-500" />
                      <span>{i18n.language === 'la' ? 'ອັບໂຫຼດຮູບໃບບິນ (JPG/PNG)' : 'Upload Receipt Photo'}</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Bill Remark */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                  {i18n.language === 'la' ? 'ໝາຍເຫດລວມຂອງໃບບິນ' : 'Bill Note / Memo'}
                </label>
                <input 
                  type="text"
                  placeholder={i18n.language === 'la' ? 'ເຊັ່ນ: ໃບບິນຮອບເຊົ້າ, ສົ່ງດ່ວນ...' : 'e.g. Morning delivery batch...'}
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-medium outline-none text-slate-800 dark:text-white"
                  value={billRemark}
                  onChange={e => setBillRemark(e.target.value)}
                />
              </div>

              {/* Multi-Item Entries List */}
              <div className="space-y-4 pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-1.5">
                    <ShoppingBag className="w-3.5 h-3.5 text-primary dark:text-blue-400" />
                    <span>{i18n.language === 'la' ? 'ລາຍການສິນຄ້າໃນບິນ' : 'Bill Items'} ({billItems.length})</span>
                  </span>
                  
                  <button
                    type="button"
                    onClick={addNewItemRow}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-[10px] font-black uppercase transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{i18n.language === 'la' ? 'ເພີ່ມລາຍການ' : 'Add Item'}</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {billItems.map((item, index) => {
                    const selectedProd = products.find(p => p.id === item.productId);

                    return (
                      <div 
                        key={item.id} 
                        className="p-4 rounded-2xl bg-slate-50/80 dark:bg-[#052659]/60 border border-slate-200/80 dark:border-white/10 space-y-3 relative transition-all"
                      >
                        {/* Item Row Header */}
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 bg-white dark:bg-white/10 text-slate-600 dark:text-slate-300 rounded-md font-mono">
                            #{index + 1}
                          </span>

                          {billItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItemRow(index)}
                              className="p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                              title="Delete Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Product Search & Dropdown */}
                        <div className="space-y-1 relative">
                          <label className="text-[9.5px] font-bold uppercase text-slate-500 dark:text-slate-400">
                            {t('product_resource')}
                          </label>
                          <div className="relative">
                            <input 
                              type="text"
                              required
                              className={`w-full h-11 px-3 pr-8 rounded-xl bg-white dark:bg-[#073069] border text-xs font-bold outline-none transition-all ${
                                !item.productId && item.productSearch 
                                  ? 'border-amber-400 text-amber-600' 
                                  : 'border-slate-200 dark:border-white/10 text-slate-800 dark:text-white'
                              }`}
                              placeholder={t('search_params') + "..."}
                              value={item.isDropdownOpen ? item.productSearch : (selectedProd?.name || item.productSearch)}
                              onFocus={() => {
                                if (selectedProd && !item.productSearch) {
                                  updateItemRow(index, { productSearch: selectedProd.name });
                                }
                                updateItemRow(index, { isDropdownOpen: true });
                              }}
                              onBlur={() => {
                                setTimeout(() => updateItemRow(index, { isDropdownOpen: false }), 250);
                              }}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateItemRow(index, {
                                  productSearch: val,
                                  isDropdownOpen: true,
                                  productId: ''
                                });
                              }}
                            />
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />

                            {/* Dropdown Options */}
                            {item.isDropdownOpen && (
                              <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-48 overflow-y-auto">
                                {products
                                  .filter(p => !item.productSearch || p.name.toLowerCase().includes(item.productSearch.toLowerCase()))
                                  .map(p => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full text-left p-2.5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors border-b border-slate-50 dark:border-white/5 last:border-none flex justify-between items-center"
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
                                    className="w-full text-left p-3 bg-primary/5 hover:bg-primary/10 text-primary transition-colors text-xs font-bold uppercase"
                                    onClick={() => addUnlistedProductForItem(item.productSearch, index)}
                                  >
                                    + Add Custom "{item.productSearch}"
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Price Mode Toggle (Total vs Per Pack) */}
                        <div className="grid grid-cols-2 gap-2 bg-slate-200/50 dark:bg-black/20 p-1 rounded-xl">
                          <button
                            type="button"
                            onClick={() => updateItemRow(index, { priceMode: 'total' })}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-black transition-all ${
                              item.priceMode === 'total'
                                ? 'bg-[#052659] text-white shadow-xs'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                            }`}
                          >
                            {i18n.language === 'la' ? 'ລາຄາລວມ (Total)' : 'Total Price'}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateItemRow(index, { priceMode: 'per_pack' })}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-black transition-all ${
                              item.priceMode === 'per_pack'
                                ? 'bg-[#052659] text-white shadow-xs'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                            }`}
                          >
                            {i18n.language === 'la' ? 'ລາຄາ/ແພັກ (Per Pack)' : 'Per Pack'}
                          </button>
                        </div>

                        {/* Price, Qty & Unit inputs */}
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-5 space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400">
                              {i18n.language === 'la' ? 'ລາຄາ' : 'Price'} ({currency})
                            </label>
                            <input 
                              type="text"
                              required
                              placeholder="0"
                              className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-slate-800 dark:text-white"
                              value={item.displayPrice}
                              onChange={e => handleItemPriceChange(index, e.target.value)}
                            />
                          </div>

                          <div className="col-span-3 space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400">
                              {i18n.language === 'la' ? 'ຈຳນວນແພັກ' : 'Qty'}
                            </label>
                            <input 
                              type="number"
                              min="1"
                              step="any"
                              required
                              placeholder="1"
                              className="w-full h-10 px-2 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-center text-slate-800 dark:text-white"
                              value={item.quantity || ''}
                              onChange={e => updateItemRow(index, { quantity: parseFloat(e.target.value) || 1 })}
                            />
                          </div>

                          <div className="col-span-4 space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400">
                              {i18n.language === 'la' ? 'ຫົວໜ່ວຍ' : 'Unit'}
                            </label>
                            <select 
                              className="w-full h-10 px-2 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase text-slate-800 dark:text-white"
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

                        {/* Optional Sub-item packing ratio & remark */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <input 
                            type="number"
                            min="1"
                            placeholder="Items per pack (e.g. 1)"
                            className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-[10px] font-bold text-slate-800 dark:text-white"
                            value={item.quantityPerUnit || ''}
                            onChange={e => updateItemRow(index, { quantityPerUnit: parseFloat(e.target.value) || 1 })}
                            title="Sub-items inside one pack"
                          />
                          <input 
                            type="text"
                            placeholder="Item note / remark..."
                            className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-[10px] font-medium text-slate-800 dark:text-white"
                            value={item.remark}
                            onChange={e => updateItemRow(index, { remark: e.target.value })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bill Grand Total Card */}
              <div className="p-4 bg-[#052659] text-white rounded-2xl flex justify-between items-center shadow-lg">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#5483B3]">
                    {i18n.language === 'la' ? 'ຍອດລວມທັງໝົດຂອງໃບບິນ (Grand Total)' : 'Bill Grand Total (LAK)'}
                  </p>
                  <p className="text-xl font-black tracking-tight mt-0.5">
                    {Math.round(grandTotalLAK).toLocaleString()} ₭
                  </p>
                  <p className="text-[9.5px] text-blue-200/70 font-mono mt-0.5">
                    {billItems.length} {billItems.length > 1 ? 'items' : 'item'} • {generatedBillNo}
                  </p>
                </div>
                <div className="p-3 bg-white/10 rounded-xl">
                  <Receipt className="w-6 h-6 text-[#5483B3]" />
                </div>
              </div>

              {/* Save Batch Button */}
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
                <span>
                  {saveLoading 
                    ? 'SAVING BILL...' 
                    : (i18n.language === 'la' ? `ບັນທຶກໃບບິນ (${billItems.length} ລາຍການ)` : `Save Bill (${billItems.length} items)`)}
                </span>
              </button>
            </form>
          </div>
        </div>

        {/* ================= PRICING INDEX FEED & TABLE (RIGHT - 7 COLS) ================= */}
        <div className="xl:col-span-7 space-y-6">

          {/* Quick Chart summary of last 10 entries */}
          <div className="high-density-card p-0 flex flex-col overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            <div className="p-3.5 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex justify-between items-center">
              <h4 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-primary dark:text-blue-400" />
                <span>{i18n.language === 'la' ? 'ດັດຊະນີລາຄາ 10 ລາຍການລ່າສຸດ (Recent Pricing Feed)' : 'Recent Pricing Feed (Last 10 entries)'}</span>
              </h4>
            </div>
            <div className="p-4 h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lastTenPrices}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" opacity={0.5} />
                  <XAxis 
                    dataKey="supplier" 
                    tick={{fontSize: 9, fontWeight: 700}} 
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#052659', 
                      border: '1px solid rgba(255,255,255,0.1)', 
                      borderRadius: '12px', 
                      fontSize: '11px',
                      fontWeight: 800,
                      color: '#fff'
                    }}
                    formatter={(val: number) => [`${val.toLocaleString()} ₭`, 'Total LAK']}
                  />
                  <Bar dataKey="totalLAK" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Active Pricing Index Table with Filter & Export */}
          <div className="high-density-card p-0 flex flex-col min-h-[500px] overflow-hidden bg-white dark:bg-[#073069] border border-slate-200/80 dark:border-white/10 shadow-xl rounded-3xl">
            
            {/* Table Control Header */}
            <div className="p-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex flex-wrap justify-between items-center gap-3 sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">
                  {t('active_pricing_index')}
                </h3>
                <button 
                  onClick={handleExport}
                  className="flex items-center gap-1 text-[9px] font-black uppercase text-blue-500 hover:text-blue-600 transition-colors"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" />
                  Excel
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Date Filter */}
                <div className="flex items-center gap-1 border border-slate-200 dark:border-white/10 p-1 bg-white dark:bg-slate-800 rounded-xl shadow-xs">
                  <span className="text-[9px] font-black uppercase text-slate-400 pl-1">
                    {i18n.language === 'la' ? 'ວັນທີ:' : 'Date:'}
                  </span>
                  <input 
                    type="date" 
                    value={selectedFilterDate}
                    onChange={e => setSelectedFilterDate(e.target.value)}
                    className="text-[10px] font-bold font-mono py-0.5 px-1 outline-none bg-transparent cursor-pointer text-slate-800 dark:text-white"
                  />
                  {selectedFilterDate ? (
                    <button 
                      type="button"
                      onClick={() => setSelectedFilterDate('')}
                      className="px-1.5 py-0.5 text-[8px] font-black uppercase bg-red-50 hover:bg-red-100 text-red-500 rounded-md"
                    >
                      {i18n.language === 'la' ? 'ທັງໝົດ' : 'All'}
                    </button>
                  ) : null}
                </div>

                {/* Text Filter */}
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Search product, supplier, #bill..." 
                    className="text-[10px] font-bold py-1.5 pl-7 pr-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-1 focus:ring-primary w-44 shadow-xs"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                  <Search className="absolute left-2.5 top-2.5 w-3 h-3 text-slate-400" />
                </div>
              </div>
            </div>

            {/* Table Contents */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-blue-200/40 bg-slate-100/50 dark:bg-white/5">
                  <tr>
                    <th className="p-4">{i18n.language === 'la' ? 'ເລກບິນ / ວັນທີ' : 'Bill No / Date'}</th>
                    <th className="p-4">{t('resource_identifier')}</th>
                    <th className="p-4">{t('origin_supplier')}</th>
                    <th className="p-4">{t('valuation_lak')}</th>
                    <th className="p-4 text-right">{t('units')}</th>
                    <th className="p-4 text-center">{i18n.language === 'la' ? 'ໃບບິນ' : 'Receipt'}</th>
                    <th className="p-4 text-right">{t('ops')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-xs">
                  {sortedSupplierPrices
                    .filter(p => {
                      const prodName = products.find(prod => prod.id === p.productId)?.name || '';
                      const billNumber = p.billNo || '';
                      const supplierName = p.supplier || '';
                      const matchesSearch = 
                        prodName.toLowerCase().includes(filter.toLowerCase()) || 
                        supplierName.toLowerCase().includes(filter.toLowerCase()) ||
                        billNumber.toLowerCase().includes(filter.toLowerCase());
                      const matchesDate = !selectedFilterDate || p.date === selectedFilterDate;
                      return matchesSearch && matchesDate;
                    })
                    .map(price => {
                      const item = products.find(p => p.id === price.productId);
                      const isNew = price.totalPriceLAK !== undefined;
                      const totalLAK = isNew
                        ? Number(price.totalPriceLAK || 0)
                        : (price.currency === 'LAK' ? Number(price.priceOriginal || 0) : Number(price.priceOriginal || 0) * Number(price.exchangeRate || 1));
                      const packPrice = isNew ? Number(price.priceLAK || 0) : totalLAK / (Number(price.quantity) || 1);

                      return (
                        <tr key={price.id} className="hover:bg-slate-50/80 dark:hover:bg-white/5 transition-all group">
                          {/* Bill No & Date */}
                          <td className="p-4">
                            {price.billNo ? (
                              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md text-[9.5px] font-mono font-black tracking-wider block mb-1 w-fit">
                                {price.billNo}
                              </span>
                            ) : null}
                            <div className="text-[11px] font-bold text-slate-800 dark:text-white">
                              {price.date || (price.createdAt ? format(price.createdAt.toDate(), 'dd MMM yyyy') : 'Pending')}
                            </div>
                            <div className="text-[9px] font-bold text-slate-400">
                              {price.time || ''}
                            </div>
                          </td>

                          {/* Product Name & Details */}
                          <td className="p-4">
                            <div className="text-[12px] font-bold text-slate-800 dark:text-blue-300">
                              {item?.name || 'Unlabeled Resource'}
                            </div>
                            {price.remark && (
                              <p className="text-[9.5px] italic text-pink-500 dark:text-pink-400 mt-0.5 max-w-[150px] truncate">
                                "{price.remark}"
                              </p>
                            )}
                          </td>

                          {/* Supplier */}
                          <td className="p-4">
                            <span className="px-2.5 py-1 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white rounded-lg text-[9.5px] font-black uppercase">
                              {price.supplier}
                            </span>
                          </td>

                          {/* Valuation in LAK */}
                          <td className="p-4">
                            <div className="text-[12px] font-black text-slate-900 dark:text-white font-mono">
                              {Math.round(totalLAK).toLocaleString()} ₭
                            </div>
                            <div className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400/90 mt-0.5">
                              {Math.round(packPrice).toLocaleString()} ₭ / {price.unit || 'UNIT'}
                            </div>
                          </td>

                          {/* Quantity & Sub-items */}
                          <td className="p-4 text-right">
                            <span className="text-[12px] font-black text-slate-900 dark:text-white">{price.quantity}</span>
                            <span className="text-[9.5px] font-bold text-slate-400 uppercase ml-1">{price.unit || 'UNIT'}</span>
                            {price.quantityPerUnit > 1 && (
                              <div className="text-[8.5px] font-bold text-blue-500 dark:text-blue-400 mt-0.5">
                                ({price.quantity * price.quantityPerUnit} sub-items)
                              </div>
                            )}
                          </td>

                          {/* Attached Receipt Image Button */}
                          <td className="p-4 text-center">
                            {price.billImageUrl ? (
                              <button
                                type="button"
                                onClick={() => setPreviewImageUrl(price.billImageUrl)}
                                className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1"
                                title="View Attached Receipt"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                                <span className="text-[8.5px] font-black uppercase">View</span>
                              </button>
                            ) : (
                              <span className="text-[9px] text-slate-300 dark:text-slate-600 font-bold">-</span>
                            )}
                          </td>

                          {/* Operations */}
                          <td className="p-4 text-right">
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
                                className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-white/10 rounded-xl transition-all"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => {
                                  setApprovalType('delete');
                                  setPendingAction(price.id);
                                  setShowApprovalModal(true);
                                }}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-white/10 rounded-xl transition-all"
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

              {supplierPrices.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Receipt className="w-10 h-10 mb-2 opacity-20" />
                  <p className="text-xs font-bold uppercase tracking-widest opacity-60">No procurement records registered yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================= RECEIPT VIEWER POPUP MODAL ================= */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col space-y-4 max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-500" />
                <span>{i18n.language === 'la' ? 'ຮູບໃບບິນແນບ (Attached Receipt Image)' : 'Attached Receipt View'}</span>
              </h4>
              <button 
                type="button" 
                onClick={() => setPreviewImageUrl(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-2xl bg-black/5 dark:bg-black/20 flex items-center justify-center p-2">
              <img 
                src={previewImageUrl} 
                alt="Receipt Full View" 
                className="max-h-[70vh] w-auto object-contain rounded-xl shadow-md"
              />
            </div>
          </div>
        </div>
      )}

      {/* ================= PRODUCT MANAGER MODAL ================= */}
      {showProductManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-3xl p-6 md:p-8 shadow-2xl border border-white/10 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight">Manage Items</h3>
                <p className="text-[10px] font-bold text-primary dark:text-blue-400 uppercase tracking-widest mt-0.5">Edit or Delete database resources</p>
                <button 
                  type="button"
                  onClick={() => setShowMergeModal(true)}
                  className="mt-2 text-[9.5px] font-black text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 py-1 px-3 rounded-full cursor-pointer transition flex items-center gap-1"
                >
                  <span>🔄 ໂຮມສິນຄ້າຊ້ຳຊ້ອນ / Merge Duplicates</span>
                </button>
              </div>
              <button type="button" onClick={() => setShowProductManager(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {products.map(p => (
                <div key={p.id} className="p-3.5 bg-slate-50 dark:bg-white/5 rounded-2xl flex items-center justify-between group">
                  <div className="flex-1 mr-3">
                    {editingProduct?.id === p.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input 
                            autoFocus
                            className="flex-1 h-9 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                            value={editProductName}
                            onChange={e => setEditProductName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUpdateProductName(p.id)}
                          />
                          <button 
                            type="button"
                            onClick={() => handleUpdateProductName(p.id)}
                            className="p-2 bg-emerald-500 text-white rounded-xl hover:scale-105 transition-transform"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button 
                            type="button"
                            onClick={() => setEditingProduct(null)}
                            className="p-2 bg-slate-200 dark:bg-white/10 rounded-xl"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <input 
                          className="w-full h-8 px-3 rounded-lg bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-[11px] font-bold text-slate-800 dark:text-white"
                          placeholder="Unit (e.g. ml, g, pcs, BOX...)"
                          value={editProductUnit}
                          onChange={e => setEditProductUnit(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{p.name}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{p.unit || 'UNIT'}</p>
                      </div>
                    )}
                  </div>
                  
                  {editingProduct?.id !== p.id && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        type="button"
                        onClick={() => {
                          setEditingProduct(p);
                          setEditProductName(p.name);
                          setEditProductUnit(p.unit || '');
                          setEditProductIsDurable(p.isDurable || false);
                          setEditProductBoxSize(p.boxSize || 12);
                        }}
                        className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleDeleteProduct(p.id)}
                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                      >
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
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase">
                🔄 ໂຮມສິນຄ້າຊ້ຳຊ້ອນ / Merge Duplicates
              </h3>
              <button type="button" onClick={() => setShowMergeModal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">
                  1. ເລືອກສິນຄ້າເກົ່າ (ທີ່ຈະລົບອອກ)
                </label>
                <select
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold outline-none text-slate-800 dark:text-white"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                >
                  <option value="">-- ເລືອກ --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit || 'g'})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">
                  2. ເລືອກສິນຄ້າຫຼັກ (ທີ່ຈະເກັບໄວ້)
                </label>
                <select
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold outline-none text-slate-800 dark:text-white"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                >
                  <option value="">-- ເລືອກ --</option>
                  {products.filter(p => p.id !== mergeSourceId).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit || 'g'})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">
                  3. ປັດໄຈຄູນປ່ຽນຫົວໜ່ວຍ (Multiplier)
                </label>
                <input
                  type="number"
                  step="any"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white"
                  value={mergeMultiplier}
                  onChange={(e) => setMergeMultiplier(parseFloat(e.target.value) || 1)}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl font-black text-xs uppercase"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMerging || !mergeSourceId || !mergeTargetId}
                onClick={handleMergeProducts}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase"
              >
                {isMerging ? 'Processing...' : 'Merge Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= EDIT SINGLE PRICE MODAL ================= */}
      {editingPriceId && editPriceData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/10 flex flex-col space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-1.5">
                <Edit3 className="w-4 h-4 text-blue-500" />
                <span>Modify Price Entry</span>
              </h3>
              <button type="button" onClick={() => { setEditingPriceId(null); setEditPriceData(null); }}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Bill No</label>
                <input 
                  type="text"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white"
                  value={editPriceData.billNo || ''}
                  onChange={e => setEditPriceData({...editPriceData, billNo: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Date</label>
                  <input 
                    type="date"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold text-slate-800 dark:text-white"
                    value={editPriceData.date || ''}
                    onChange={e => setEditPriceData({...editPriceData, date: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Supplier</label>
                  <input 
                    type="text"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold text-slate-800 dark:text-white"
                    value={editPriceData.supplier || ''}
                    onChange={e => setEditPriceData({...editPriceData, supplier: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Original Price</label>
                  <input 
                    type="number"
                    step="any"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white"
                    value={editPriceData.priceOriginal || 0}
                    onChange={e => setEditPriceData({...editPriceData, priceOriginal: parseFloat(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Quantity</label>
                  <input 
                    type="number"
                    step="any"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white"
                    value={editPriceData.quantity || 1}
                    onChange={e => setEditPriceData({...editPriceData, quantity: parseFloat(e.target.value) || 1})}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">Remark</label>
                <input 
                  type="text"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-medium text-slate-800 dark:text-white"
                  value={editPriceData.remark || ''}
                  onChange={e => setEditPriceData({...editPriceData, remark: e.target.value})}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setEditingPriceId(null); setEditPriceData(null); }}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl font-black text-xs uppercase"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saveLoading}
                onClick={handleUpdatePrice}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase"
              >
                {saveLoading ? 'Saving...' : 'Update Record'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
