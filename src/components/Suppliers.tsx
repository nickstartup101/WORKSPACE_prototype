import React, { useState, useEffect } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  getDocs, where, deleteDoc, doc, updateDoc,
  Timestamp, serverTimestamp
} from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, Legend
} from 'recharts';
import { Plus, Trash2, Edit3, Save, X, Search, ShieldCheck, Truck, Clock, AlertCircle, Download, BarChart3, List, Check, TrendingUp, Receipt, ShoppingBag, Layers, Info } from 'lucide-react';
import { format } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';
import { COMMON_RESOURCES } from '../constants';
import ApprovalModal from './ApprovalModal';

export default function Suppliers() {
  const { t, i18n } = useTranslation();
  const [displayPrice, setDisplayPrice] = useState('');

  const formatWithCommas = (val: string) => {
    const num = val.replace(/,/g, '');
    if (!num) return '';
    if (isNaN(Number(num))) return displayPrice;
    return Number(num).toLocaleString();
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/,/g, '');
    if (rawValue === '' || !isNaN(Number(rawValue))) {
      const formatted = formatWithCommas(e.target.value);
      setDisplayPrice(formatted);
      setNewPrice({ ...newPrice, priceOriginal: Number(rawValue) || 0 });
    }
  };

  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [selectedFilterDate, setSelectedFilterDate] = useState<string>(''); // Default empty for "All Dates"
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [showProductManager, setShowProductManager] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editProductName, setEditProductName] = useState('');
  const [editProductUnit, setEditProductUnit] = useState('');
  const [editProductIsDurable, setEditProductIsDurable] = useState(false);
  const [editProductBoxSize, setEditProductBoxSize] = useState<number>(12);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceData, setEditPriceData] = useState<any>(null);
  const [expandedBills, setExpandedBills] = useState<{ [supplier: string]: boolean }>({});
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<any | null>(null);

  // Sort supplierPrices by date (yyyy-MM-dd) descending, then by time descending, and fallback to server createdAt timestamp
  const sortedSupplierPrices = React.useMemo(() => {
    return [...supplierPrices].sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA); // Date descending
      }
      const timeA = a.time || '';
      const timeB = b.time || '';
      if (timeA !== timeB) {
        return timeB.localeCompare(timeA); // Time descending
      }
      const secondsA = a.createdAt?.seconds || 0;
      const secondsB = b.createdAt?.seconds || 0;
      return secondsB - secondsA; // CreatedAt seconds descending
    });
  }, [supplierPrices]);

  const priceInsights = React.useMemo(() => {
    const list: any[] = [];
    const productGroups: { [key: string]: any[] } = {};
    
    // Group items by product ID to compare price per logical unit
    [...supplierPrices].reverse().forEach(p => {
      if (!p.productId) return;
      if (!productGroups[p.productId]) productGroups[p.productId] = [];
      productGroups[p.productId].push(p);
    });

    Object.entries(productGroups).forEach(([prodId, prices]) => {
      if (prices.length < 2) return;
      
      const latest = prices[prices.length - 1];
      const previous = prices[prices.length - 2];
      
      // Use standardized unit price for comparison (Pack Price / Pack Size)
      const getStandardUnitPrice = (p: any) => {
        const isNew = p.totalPriceLAK !== undefined || p.priceMode !== undefined;
        const totalLAK = isNew
          ? Number(p.totalPriceLAK || 0)
          : (p.currency === 'LAK'
              ? Number(p.priceOriginal || 0)
              : Number(p.priceOriginal || 0) * Number(p.exchangeRate || 1));
        const packPrice = isNew
          ? Number(p.priceLAK || 0)
          : totalLAK / Number(p.quantity || 1);
        return packPrice / Number(p.quantityPerUnit || 1);
      };

      const latestStandardPrice = getStandardUnitPrice(latest);
      const prevStandardPrice = getStandardUnitPrice(previous);
      
      if (prevStandardPrice > 0) {
        const diff = (latestStandardPrice - prevStandardPrice) / prevStandardPrice;
        if (Math.abs(diff) >= 0.08) {
          const product = products.find(p => p.id === latest.productId);
          list.push({
            productId: latest.productId,
            productName: product?.name || 'Item',
            unit: latest.unit || 'UNIT',
            supplier: latest.supplier,
            diff: diff * 100,
            type: diff > 0 ? 'increase' : 'decrease',
            latestPrice: latestStandardPrice,
            prevPrice: prevStandardPrice,
            latestRecord: latest,
            prevRecord: previous
          });
        }
      }
    });
    return list;
  }, [supplierPrices, products]);

  const finalInsights = React.useMemo(() => {
    const list = [...priceInsights];

    // Guarantee exactly 5 alerts by pushing highly relevant system alerts
    if (list.length < 5) {
      list.push({
        isSystem: true,
        type: 'compare',
        productName: i18n.language === 'la' ? 'ປຽບທຽບ 3 ຜູ້ສະໜອງ' : '3-Supplier Price System',
        unit: 'LAK',
        message: i18n.language === 'la'
          ? 'ຊ່ວຍຄົ້ນຫາ ແລະ ຈັດອັບດັບລາຄາທີ່ດີທີ່ສຸດຈາກຜູ້ສະໜອງເພື່ອຫຼຸດຕົ້ນທຶນ ແລະ ເພີ່ມກຳໄລສູງສຸດໃຫ້ກັບຮ້ານ!'
          : 'Instantly matches and lists the lowest cost quotes across LATDA, DMART, and active suppliers to prevent double spend.'
      });
    }

    if (list.length < 5) {
      list.push({
        isSystem: true,
        type: 'dual_mode',
        productName: i18n.language === 'la' ? 'ການປ້ອນລາຄາສະດວກ' : 'Flexible Entry Modes',
        unit: 'Entry',
        message: i18n.language === 'la'
          ? 'ບໍ່ຈຳເປັນຕ້ອງປ້ອນທັງສອງ! ປ້ອນພຽງ "ລາຄາລວມ" ຫຼື "ລາຄາຕໍ່ແພັກ" ຢ່າງໃດຢ່າງໜຶ່ງ, ລະບົບຈະຄິດໄລ່ໃຫ້ເອງທັນທີ!'
          : 'Fill either "Total Paid" OR "Price per Pack". The matching counterpart is processed instantly on your behalf.'
      });
    }

    if (list.length < 5) {
      list.push({
        isSystem: true,
        type: 'is_durable',
        productName: i18n.language === 'la' ? 'ຈັດການເຄື່ອງໃຊ້ Durable' : 'Durable Asset Controls',
        unit: 'Durable',
        message: i18n.language === 'la'
          ? 'ສິນຄ້າທີ່ຕິດປ້າຍ Durable ເປັນເຄື່ອງໃຊ້/ອຸປະກອນ ຈະມີອັດຕາເຜົາຜານລາຍວັນເປັນ 0, ແຈ້ງເຕືອນ Restock ເມື່ອຫຼຸດ Min Stock.'
          : 'Setting items to Durable locks down daily rate of depletion to zero. Restock alerts only fire off under Min Stock limits.'
      });
    }

    if (list.length < 5) {
      list.push({
        isSystem: true,
        type: 'live_status',
        productName: i18n.language === 'la' ? 'ດັດຊະນີລາຄາສົດ' : 'Real-time Price Index Feed',
        unit: 'Database',
        message: i18n.language === 'la'
          ? 'ລະບົບເຊື່ອມຕໍ່ກັບ Cloud Firestore ແບບສົດໆ 100% ຂໍ້ມູນທຸກຢ່າງຈະຖືກຄິດໄລ່ ແລະ ແບ່ງປັນໄປໃບບິນ ແລະ ສູດອັດຕະໂນມັດ!'
          : 'Connected live with Google Firestore. Any changes immediately flow down to active recipe costing sheets.'
      });
    }

    if (list.length < 5) {
      list.push({
        isSystem: true,
        type: 'saving_advice',
        productName: i18n.language === 'la' ? 'ຄຳແນະນຳປະຢັດຕົ້ນທຶນ' : 'Procurement Cost Optimization',
        unit: 'Saving',
        message: i18n.language === 'la'
          ? 'ແນະນຳໃຫ້ສົມທຽບໃບສະເໜີລາຄາໃໝ່ທຸກໆອາທິດ ເພື່ອໃຫ້ໄດ້ຮັບສ່ວນຫຼຸດ ແລະ ຂໍ້ສະເໜີທີ່ດີທີ່ສຸດສະເໝີ.'
          : 'Compare new quote entries weekly to capture early supplier price reductions and special promotional batches.'
      });
    }

    return list.slice(0, 5);
  }, [priceInsights, i18n.language]);

  // Pricing comparison interactive states
  const [selectedCompProduct, setSelectedCompProduct] = useState<string>('');
  const [purchaseQty, setPurchaseQty] = useState<number>(10);

  const supplierComparison = React.useMemo(() => {
    const comparisonMap: { [productId: string]: { [supplier: string]: { price: number, date: string, rawRecord: any } } } = {};

    // Sort supplierPrices by date ascending so latest overwrites older quotes
    const sortedPrices = [...supplierPrices].sort((a, b) => {
      const timeA = a.createdAt?.toDate?.()?.getTime() || new Date(a.date).getTime();
      const timeB = b.createdAt?.toDate?.()?.getTime() || new Date(b.date).getTime();
      return timeA - timeB;
    });

    sortedPrices.forEach(p => {
      if (!p.productId || !p.supplier) return;
      if (!comparisonMap[p.productId]) {
        comparisonMap[p.productId] = {};
      }
      const isNew = p.totalPriceLAK !== undefined || p.priceMode !== undefined;
      const packPrice = isNew
        ? Number(p.priceLAK || 0)
        : (p.currency === 'LAK' ? Number(p.priceOriginal || 0) : Number(p.priceOriginal || 0) * Number(p.exchangeRate || 1)) / Number(p.quantity || 1);
      const unitPrice = packPrice / Number(p.quantityPerUnit || 1);
      comparisonMap[p.productId][p.supplier] = {
        price: unitPrice,
        date: p.date,
        rawRecord: p
      };
    });

    const list: any[] = [];
    Object.entries(comparisonMap).forEach(([prodId, supplierMap]) => {
      const product = products.find(p => p.id === prodId);
      if (!product) return;

      const rankedSuppliers = Object.entries(supplierMap).map(([supplier, data]) => ({
        supplier,
        unitPrice: data.price,
        date: data.date,
        currency: data.rawRecord.currency,
        priceOriginal: data.rawRecord.priceOriginal,
        quantityPerUnit: data.rawRecord.quantityPerUnit || 1,
        unit: data.rawRecord.unit || product.unit || 'UNIT'
      })).sort((a, b) => a.unitPrice - b.unitPrice);

      if (rankedSuppliers.length > 0) {
        const best = rankedSuppliers[0];
        const worst = rankedSuppliers[rankedSuppliers.length - 1];
        const savingsPerUnit = worst.unitPrice - best.unitPrice;
        const savingsPercent = worst.unitPrice > 0 ? (savingsPerUnit / worst.unitPrice) * 100 : 0;

        list.push({
          productId: prodId,
          productName: product.name,
          unit: product.unit || best.unit || 'UNIT',
          rankedSuppliers,
          bestSupplier: best.supplier,
          bestPrice: best.unitPrice,
          savingsPerUnit,
          savingsPercent,
          hasComparison: rankedSuppliers.length > 1
        });
      }
    });

    return list;
  }, [supplierPrices, products]);

  const optimizedBills = React.useMemo(() => {
    const groups: { [supplier: string]: { productId: string, productName: string, price: number, unit: string }[] } = {};
    supplierComparison.forEach(comp => {
      const best = comp.rankedSuppliers[0];
      if (best) {
        if (!groups[best.supplier]) {
          groups[best.supplier] = [];
        }
        groups[best.supplier].push({
          productId: comp.productId,
          productName: comp.productName,
          price: best.unitPrice,
          unit: comp.unit
        });
      }
    });

    return Object.entries(groups).map(([supplier, items]) => ({
      supplier,
      items,
      totalItems: items.length
    })).sort((a, b) => b.totalItems - a.totalItems);
  }, [supplierComparison]);

  useEffect(() => {
    if (selectedCompProduct === '' && supplierComparison.length > 0) {
      const firstWithComp = supplierComparison.find(c => c.hasComparison) || supplierComparison[0];
      if (firstWithComp) {
        setSelectedCompProduct(firstWithComp.productId);
      }
    }
  }, [supplierComparison, selectedCompProduct]);

  const [selectedChartProductId, setSelectedChartProductId] = useState<string | null>(null);
  const [selectedChartUnit, setSelectedChartUnit] = useState<string>('');

  const chartData = React.useMemo(() => {
    if (!selectedChartProductId) return [];
    
    return [...supplierPrices]
      .filter(p => p.productId === selectedChartProductId)
      .sort((a, b) => (a.createdAt?.toDate?.()?.getTime() || 0) - (b.createdAt?.toDate?.()?.getTime() || 0))
      .map(p => {
        const isNew = p.totalPriceLAK !== undefined || p.priceMode !== undefined;
        const totalLAK = isNew
          ? Number(p.totalPriceLAK || 0)
          : (p.currency === 'LAK'
              ? Number(p.priceOriginal || 0)
              : Number(p.priceOriginal || 0) * Number(p.exchangeRate || 1));
        const packPrice = isNew
          ? Number(p.priceLAK || 0)
          : totalLAK / Number(p.quantity || 1);
        const subUnitPrice = packPrice / Number(p.quantityPerUnit || 1);

        return {
          date: format(p.createdAt?.toDate?.() || new Date(), 'dd/MM'),
          price: subUnitPrice,
          supplier: p.supplier,
          unitLabel: `${p.quantity} ${p.unit || 'UNIT'}`
        };
      });
  }, [selectedChartProductId, supplierPrices]);

  const lastTenPrices = React.useMemo(() => {
    return [...supplierPrices].slice(0, 10).reverse().map(p => {
      const totalLAK = p.currency === 'LAK' ? p.priceOriginal : p.priceOriginal * (p.exchangeRate || 1);
      return {
        ...p,
        totalLAK,
      };
    });
  }, [supplierPrices]);

  const [saveLoading, setSaveLoading] = useState(false);

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
    if (!confirm("Are you sure you want to delete this product? This will not delete historical price records but might make them show as 'Unknown Item'.")) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      alert("Product deleted successfully");
    } catch (err: any) {
      console.error("Delete Error:", err);
      if (err.message.includes("permission-denied") || err.message.includes("permissions")) {
        alert("Permission Denied: You do not have rights to delete this item.");
      } else {
        alert("Error deleting product. It might be in use or connection lost.");
      }
      handleFirestoreError(err, OperationType.DELETE, 'products');
    }
  };
  
  // Merge Products / Mismatched unit converter states
  const [recipes, setRecipes] = useState<any[]>([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeMultiplier, setMergeMultiplier] = useState(1);
  const [isMerging, setIsMerging] = useState(false);

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

    const msg = i18n.language === 'la'
      ? `ທ່ານແນ່ໃຈບໍ່ທີ່ຈະໂຮມ ແລະ ປ່ຽນຊື່ "${sourceProd.name}" (ຫົວໜ່ວຍ: ${sourceProd.unit || 'g'}) ເຂົ້າກັບ "${targetProd.name}" (ຫົວໜ່ວຍ: ${targetProd.unit || 'g'})?
ປະຫວັດລາຄາຜູ້ສະໜອງທັງໝົດ ຈະຖືກປ່ຽນໄປຫາ "${targetProd.name}" ໂດຍຄູນດ້ວຍປັດໄຈປ່ຽນຫົວໜ່ວຍ x${mergeMultiplier}. ແລະສິນຄ້າເກົ່າຈະຖືກລົບອອກ.`
      : `Are you sure you want to merge and rename "${sourceProd.name}" (unit: ${sourceProd.unit || 'g'}) into "${targetProd.name}" (unit: ${targetProd.unit || 'g'})?
All supplier price records will be reassigned to "${targetProd.name}" and scaled by conversion multiplier x${mergeMultiplier}. The old item will be deleted.`;

    if (!confirm(msg)) return;

    try {
      setIsMerging(true);

      // 1. Reassign price entries in 'supplierPrices'
      const priceDocs = supplierPrices.filter(sp => sp.productId === mergeSourceId);
      for (const priceDoc of priceDocs) {
        const newQtyPerUnit = (priceDoc.quantityPerUnit || 1) * mergeMultiplier;
        await updateDoc(doc(db, 'supplierPrices', priceDoc.id), {
          productId: mergeTargetId,
          quantityPerUnit: newQtyPerUnit,
          remark: `${priceDoc.remark || ''} (Merged from ${sourceProd.name})`.trim()
        });
      }

      // 2. Delete the source product
      await deleteDoc(doc(db, 'products', mergeSourceId));

      alert(i18n.language === 'la' ? "ໂຮມສິນຄ້າ ແລະ ປັບປຸງປະຫວັດສົມບູນແລ້ວ!" : "Successfully merged products and synchronized all supplier prices!");
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

  // Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPrice, setNewPrice] = useState({
    productId: '',
    supplier: '',
    currency: 'LAK',
    exchangeRate: 1,
    priceOriginal: 0,
    priceLAK: 0,
    quantity: 1,
    quantityPerUnit: 1,
    unit: '',
    remark: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: format(new Date(), 'HH:mm'),
    priceMode: 'total' as 'total' | 'per_pack'
  });

  // Admin Approval State
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'create' | 'delete' | 'new_product' | null>(null);
  const [pendingAction, setPendingAction] = useState<any>(null);

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

    const qR = query(collection(db, 'recipes'));
    const unsubscribeR = onSnapshot(qR, (snap) => {
      setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubscribeP();
      unsubscribeS();
      unsubscribeR();
    };
  }, []);

  const renderInsightItem = (insight: any, idx: number) => {
    const isIncrease = insight.type === 'increase';
    const indicatorColor = insight.isSystem
      ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
      : isIncrease
        ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
        : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';

    const isClickable = !insight.isSystem;

    return (
      <div 
        key={insight.id || idx} 
        onClick={() => {
          if (isClickable) {
            setSelectedInsight(insight);
          }
        }}
        className={`flex gap-4 items-start animate-in fade-in slide-in-from-right duration-500 ${
          isClickable 
            ? 'cursor-pointer hover:bg-slate-100/55 dark:hover:bg-white/5 p-2 -m-2 rounded-xl border border-transparent hover:border-slate-100 dark:hover:border-white/5 transition-all' 
            : ''
        }`}
        style={{ animationDelay: `${idx * 150}ms` }}
      >
        <div className={`w-1.5 h-11 rounded-full mt-1 shrink-0 ${indicatorColor}`}></div>
        <div className="flex-1 min-w-0">
          {insight.isSystem ? (
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-1.5 shrink-0">
                <span className="px-1 py-0.5 bg-blue-500/10 text-blue-500 rounded text-[8px] font-black tracking-widest shrink-0">SYS</span>
                <span className="truncate">{insight.productName}</span>
              </p>
              <p className="text-[10px] text-slate-500 dark:text-blue-100/50 leading-normal mt-1">
                {insight.message}
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-1">
                <p className={`text-xs font-bold uppercase tracking-wider ${isIncrease ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {insight.productName} ({insight.unit}): {isIncrease ? 'ລາຄາຂຶ້ນ' : 'ລາຄາລົງ'} {Math.abs(insight.diff).toFixed(1)}%
                </p>
                <span className="text-[8px] font-black uppercase text-blue-500 bg-blue-500/10 px-1 rounded tracking-wider shrink-0">
                  {i18n.language === 'la' ? 'ກົດເບິ່ງ' : 'Details'}
                </span>
              </div>
              <p className="text-[10px] text-slate-600 dark:text-blue-100/60 leading-normal mt-1">
                 ສິນຄ້າຈາກ {insight.supplier || ''} ມີການປ່ຽນແປງລາຄາເກີນ 8%. ຈາກ {(insight.prevPrice || 0).toLocaleString()} ₭/{(insight.unit || '')} ເປັນ {(insight.latestPrice || 0).toLocaleString()} ₭/{(insight.unit || '')}.
              </p>
              <p className="text-[8.5px] font-bold text-slate-400 dark:text-slate-400/60 mt-0.5 italic">
                {i18n.language === 'la' ? '➔ ແຕະເພື່ອເບິ່ງວັນທີປຽບທຽບ ແລະ ການຄິດໄລ່' : '➔ Tap/Click to view comparison dates & formulas'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleExport = () => {
    const headers = ['Date', 'Product', 'Supplier', 'Price LAK', 'Quantity', 'Unit', 'User'];
    const rows = supplierPrices.map(p => [
      format(p.createdAt?.toDate() || new Date(), 'yyyy-MM-dd'),
      products.find(prod => prod.id === p.productId)?.name || 'Unknown',
      p.supplier,
      p.priceLAK,
      p.quantity,
      p.unit,
      p.userEmail
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Suppliers Report');
    writeFile(workbook, `suppliers_report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const handleUpdatePrice = async () => {
    if (!editingPriceId || !editPriceData) return;
    try {
      setSaveLoading(true);
      const calculatedPriceLAK = (editPriceData.currency === 'LAK' ? editPriceData.priceOriginal : editPriceData.priceOriginal * editPriceData.exchangeRate);
      
      await updateDoc(doc(db, 'supplierPrices', editingPriceId), {
        ...editPriceData,
        priceLAK: calculatedPriceLAK,
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

  const handleAddPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newPrice.productId) {
      alert("Please select a product from the list or add a new one.");
      return;
    }

    if (!newPrice.supplier) {
      alert("Please select a supplier.");
      return;
    }

    try {
      setSaveLoading(true);
      
      let singlePriceOriginal = newPrice.priceOriginal;
      if (newPrice.priceMode === 'total') {
        singlePriceOriginal = newPrice.priceOriginal / (newPrice.quantity || 1);
      }
      
      const calculatedPriceLAK = (newPrice.currency === 'LAK' ? singlePriceOriginal : singlePriceOriginal * newPrice.exchangeRate);
      const totalOriginal = newPrice.priceMode === 'total' ? newPrice.priceOriginal : newPrice.priceOriginal * (newPrice.quantity || 1);
      const totalLAK = (newPrice.currency === 'LAK' ? totalOriginal : totalOriginal * newPrice.exchangeRate);

      await addDoc(collection(db, 'supplierPrices'), {
        ...newPrice,
        priceOriginal: singlePriceOriginal, // Stored as Price per Single Pack
        priceLAK: calculatedPriceLAK,       // Stored as LAK Price per Single Pack
        totalPriceOriginal: totalOriginal,  // Stored as total spent original currency
        totalPriceLAK: totalLAK,            // Stored as total spent in LAK
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
      });
      
      setShowAddForm(false);
      setProductSearch('');
      setDisplayPrice('');
      setNewPrice({ 
        productId: '', 
        supplier: '', 
        currency: 'LAK', 
        exchangeRate: 1, 
        priceOriginal: 0, 
        priceLAK: 0, 
        quantity: 1, 
        quantityPerUnit: 1, 
        unit: '',
        remark: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm'),
        priceMode: 'total'
      });
      alert("Supplier data saved successfully!");
    } catch (err: any) {
      console.error("Save Error:", err);
      // Friendly alert for common errors (like permission denied)
      if (err.message.includes("permission-denied") || err.message.includes("permissions")) {
        alert("Permission Denied: Ensure your email is verified and you have admin rights.");
      } else {
        alert("Error saving data. Please check your connection and try again.");
      }
      handleFirestoreError(err, OperationType.CREATE, 'supplierPrices');
    } finally {
      setSaveLoading(false);
    }
  };
  
  // Helper to handle product search input blur - try to find match
  const handleProductSearchBlur = () => {
    if (!newPrice.productId && productSearch) {
      const match = products.find(p => p.name.toLowerCase() === productSearch.toLowerCase());
      if (match) {
        setNewPrice({
          ...newPrice, 
          productId: match.id, 
          unit: match.unit || newPrice.unit,
          quantityPerUnit: match.packSize || 1
        });
        setProductSearch(match.name);
      }
    }
    // Small delay to allow clicking dropdown items
    setTimeout(() => setIsProductDropdownOpen(false), 200);
  };

  const executeApprovedAction = async () => {
    if (approvalType === 'delete' && pendingAction) {
      try {
        await deleteDoc(doc(db, 'supplierPrices', pendingAction));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'supplierPrices');
      }
    } else if (approvalType === 'create' && pendingAction) {
      try {
        setSaveLoading(true);
        const calculatedPriceLAK = (pendingAction.currency === 'LAK' ? pendingAction.priceOriginal : pendingAction.priceOriginal * pendingAction.exchangeRate);
        
        await addDoc(collection(db, 'supplierPrices'), {
          ...pendingAction,
          priceLAK: calculatedPriceLAK,
          createdAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
        });
        
        setShowAddForm(false);
        setProductSearch('');
        setNewPrice({ 
          productId: '', 
          supplier: '', 
          currency: 'LAK', 
          exchangeRate: 1, 
          priceOriginal: 0, 
          priceLAK: 0, 
          quantity: 1, 
          quantityPerUnit: 1,
          unit: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          time: format(new Date(), 'HH:mm')
        });
        alert("Supplier data saved successfully!");
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, 'supplierPrices');
      } finally {
        setSaveLoading(false);
      }
    }
    setApprovalType(null);
    setPendingAction(null);
  };

  const addUnlistedProduct = async (name: string) => {
    const productName = prompt("Enter New Product Name:", name);
    if (productName) {
      try {
        const docRef = await addDoc(collection(db, 'products'), {
          name: productName,
          unit: newPrice.unit || 'UNIT',
          isApproved: true,
          createdAt: serverTimestamp()
        });
        setNewPrice(prev => ({ ...prev, productId: docRef.id }));
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'products');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Brand New Real-time Status Bar & Help Guide trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-2xl border border-[#052659]/10 dark:border-white/5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-3.5 w-3.5 rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              {i18n.language === 'la' ? 'ດັດຊະນີລາຄາປະຈຸບັນ • ຂໍ້ມູນສົດ' : 'Current Price Index • Live Connected'}
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-350 font-bold uppercase mt-0.5">
              {i18n.language === 'la' ? 'ອັບເດດລາຄາຈາກ Firestore Realtime ສົດໆ' : 'Real-time database feed fully synced'}
            </p>
          </div>
        </div>
        
        <button
          type="button"
          onClick={() => setIsHelpModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-black text-[10px] uppercase rounded-xl shadow-md transition-all cursor-pointer text-center justify-center self-start sm:self-auto"
        >
          <Info className="w-3.5 h-3.5" />
          <span>{i18n.language === 'la' ? 'Info • ວິທີໃຊ້' : 'Info • Guide'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
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

      {/* Form Section */}
      <div className="xl:col-span-1 space-y-6">
        <div className="high-density-card">
            <div className="flex justify-between items-center mb-6">
              <h3 className="label-xs flex items-center gap-2">
                <Plus className="w-3 h-3 text-primary" />
                {t('sync_supplier_data')}
              </h3>
            </div>

          <form onSubmit={handleAddPrice} className="space-y-6">
            <div className="space-y-2 relative">
              <label className="label-xs">{t('product_resource')}</label>
              <div className="flex gap-2">
                <div className="relative flex-1 group">
                  <input 
                    type="text"
                    className={`crystal-input !text-xs h-[50px] w-full transition-all ${!newPrice.productId && productSearch ? 'border-amber-400/50 bg-amber-400/5' : ''}`}
                    placeholder={t('search_params') + "..."}
                    value={isProductDropdownOpen ? productSearch : (products.find(p => p.id === newPrice.productId)?.name || productSearch)}
                    onFocus={() => {
                      const selectedProduct = products.find(p => p.id === newPrice.productId);
                      if (selectedProduct && !productSearch) {
                        setProductSearch(selectedProduct.name);
                      }
                      setIsProductDropdownOpen(true);
                    }}
                    onBlur={handleProductSearchBlur}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProductSearch(val);
                      setIsProductDropdownOpen(true);
                      // Reset productId on typing if it doesn't match the selected product name
                      const currentSelectedName = products.find(p => p.id === newPrice.productId)?.name || '';
                      if (val.trim().toLowerCase() !== currentSelectedName.trim().toLowerCase()) {
                        setNewPrice(prev => ({ ...prev, productId: '' }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && productSearch && !newPrice.productId) {
                        e.preventDefault();
                        const match = products.find(p => p.name.toLowerCase() === productSearch.toLowerCase());
                        if (match) {
                          setNewPrice({...newPrice, productId: match.id, unit: match.unit || newPrice.unit});
                          setProductSearch(match.name);
                          setIsProductDropdownOpen(false);
                        }
                      }
                    }}
                  />
                  {!newPrice.productId && productSearch && (
                    <div className="absolute -bottom-1 left-4 px-2 bg-amber-400 text-slate-900 text-[8px] font-black rounded uppercase transform translate-y-full z-10">
                      Must select or add item
                    </div>
                  )}
                  <Search className={`absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 transition-colors ${isProductDropdownOpen ? 'text-primary' : 'text-slate-400'} pointer-events-none`} />
                  
                  {isProductDropdownOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-2 bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                      {products.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).length > 0 && (
                        <div className="p-2 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20 sticky top-0">
                          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{t('database_items')}</p>
                        </div>
                      )}
                      {products
                        .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                        .map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left p-3 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors border-b border-slate-50 dark:border-white/5 last:border-none"
                          onClick={() => {
                            setNewPrice({
                              ...newPrice, 
                              productId: p.id, 
                              unit: p.unit || newPrice.unit,
                              quantityPerUnit: p.packSize || 1
                            });
                            setProductSearch(p.name);
                            setIsProductDropdownOpen(false);
                          }}
                        >
                          <p className="text-xs font-bold text-slate-800 dark:text-white">{p.name}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{p.unit || 'UNIT'}</p>
                        </button>
                      ))}
                      
                      {COMMON_RESOURCES.filter(cr => (!productSearch || cr.toLowerCase().includes(productSearch.toLowerCase())) && !products.some(p => p.name === cr)).length > 0 && (
                        <div className="p-2 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20 sticky top-0 mt-2">
                          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{t('common_resources')}</p>
                        </div>
                      )}
                      {COMMON_RESOURCES
                        .filter(cr => (!productSearch || cr.toLowerCase().includes(productSearch.toLowerCase())) && !products.some(p => p.name === cr))
                        .map((cr, i) => (
                        <button
                          key={`cr-${i}`}
                          type="button"
                          className="w-full text-left p-3 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors border-b border-slate-50 dark:border-white/5 last:border-none"
                          onClick={async () => {
                            try {
                              const docRef = await addDoc(collection(db, 'products'), {
                                name: cr,
                                unit: newPrice.unit || 'UNIT',
                                isApproved: true,
                                createdAt: serverTimestamp()
                              });
                              setNewPrice({...newPrice, productId: docRef.id});
                              setProductSearch(cr);
                              setIsProductDropdownOpen(false);
                            } catch (err) {
                              handleFirestoreError(err, OperationType.CREATE, 'products');
                            }
                          }}
                        >
                          <p className="text-xs font-bold text-slate-800 dark:text-white italic">{cr}</p>
                          <p className="text-[8px] text-primary font-black uppercase mt-0.5">Quick Add</p>
                        </button>
                      ))}

                      {productSearch && !products.some(p => p.name.toLowerCase() === productSearch.toLowerCase()) && !COMMON_RESOURCES.some(cr => cr.toLowerCase() === productSearch.toLowerCase()) && (
                        <button
                          type="button"
                          className="w-full text-left p-4 bg-primary/5 hover:bg-primary/10 transition-colors"
                          onClick={() => {
                            addUnlistedProduct(productSearch);
                            setIsProductDropdownOpen(false);
                          }}
                        >
                          <p className="text-xs font-black text-primary uppercase">Add Custom "{productSearch}"</p>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <button 
                  type="button" 
                  onClick={() => setIsProductDropdownOpen(!isProductDropdownOpen)}
                  className={`w-[50px] h-[50px] flex items-center justify-center bg-slate-100 dark:bg-white/5 text-slate-500 rounded-2xl hover:bg-primary/10 hover:text-primary transition-all shadow-sm ${isProductDropdownOpen ? 'rotate-45 text-primary' : ''}`}
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button 
                  type="button" 
                  onClick={() => setShowProductManager(true)}
                  className="w-[50px] h-[50px] flex items-center justify-center bg-slate-100 dark:bg-white/5 text-slate-500 rounded-2xl hover:bg-primary/10 hover:text-primary transition-all shadow-sm"
                  title="Manage Products"
                >
                  <List className="w-5 h-5" />
                </button>
              </div>
              
              {/* Overlay to close dropdown */}
              {isProductDropdownOpen && (
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setIsProductDropdownOpen(false)}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="label-xs">Purchase Date</label>
                <input 
                  type="date"
                  required
                  className="crystal-input h-[50px] !text-[11px] !py-0"
                  value={newPrice.date}
                  onChange={e => setNewPrice({...newPrice, date: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="label-xs">Time</label>
                <input 
                  type="time"
                  required
                  className="crystal-input h-[50px] !text-[11px] !py-0"
                  value={newPrice.time}
                  onChange={e => setNewPrice({...newPrice, time: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="label-xs">{t('supplier')}</label>
                <select 
                  className="crystal-input !text-xs h-[50px] !py-0"
                  value={newPrice.supplier}
                  onChange={e => setNewPrice({...newPrice, supplier: e.target.value})}
                  required
                >
                  <option value="" className="bg-white dark:bg-slate-800">{t('select_item')}...</option>
                  <option value="LATDA" className="bg-white dark:bg-slate-800">LATDA</option>
                  <option value="CHANHOM" className="bg-white dark:bg-slate-800">CHANHOM</option>
                  <option value="HEAVENLY" className="bg-white dark:bg-slate-800">HEAVENLY</option>
                  <option value="DMART" className="bg-white dark:bg-slate-800">DMART</option>
                  <option value="MARRY ANN" className="bg-white dark:bg-slate-800">MARRY ANN</option>
                  <option value="OTHER" className="bg-white dark:bg-slate-800">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="label-xs">{t('currency')}</label>
                <div className="flex rounded-2xl overflow-hidden h-[50px]">
                   <select 
                    className="crystal-input !text-xs !py-0"
                    value={newPrice.currency}
                    onChange={e => setNewPrice({...newPrice, currency: e.target.value, exchangeRate: e.target.value === 'LAK' ? 1 : newPrice.exchangeRate})}
                  >
                    <option value="LAK" className="bg-white dark:bg-slate-800">LAK</option>
                    <option value="THB" className="bg-white dark:bg-slate-800">THB</option>
                    <option value="USD" className="bg-white dark:bg-slate-800">USD</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Price Input Mode Toggle */}
            <div className="space-y-2">
              <label className="label-xs">{i18n.language === 'la' ? 'ຮູບແບບການປ້ອນລາຄາ' : 'Price Input Mode'}</label>
              <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-900/45 p-1 rounded-2xl border border-slate-200/50 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setNewPrice({...newPrice, priceMode: 'total'})}
                  className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 duration-100 ${
                    newPrice.priceMode === 'total'
                      ? 'bg-[#052659] text-white shadow-md'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-200/30'
                  }`}
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>{i18n.language === 'la' ? 'ລາຄາລວມທັງໝົດ' : 'Total Price'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewPrice({...newPrice, priceMode: 'per_pack'})}
                  className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 duration-100 ${
                    newPrice.priceMode === 'per_pack'
                      ? 'bg-[#052659] text-white shadow-md'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-200/30'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>{i18n.language === 'la' ? 'ລາຄາຕໍ່ແພັກ/ຖົງ' : 'Price per Pack'}</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 italic font-medium leading-tight">
                {newPrice.priceMode === 'total' 
                  ? (i18n.language === 'la' ? 'ລະບົບຈະຄິດໄລ່ລາຄາຕໍ່ຖົງໃຫ້ອັດຕະໂນມັດ ໂດຍຫານໃຫ້ຈຳນວນທີ່ປ້ອນດ້ານລຸ່ມ' : 'Automatically calculates the per-pack price by dividing total price by quantity')
                  : (i18n.language === 'la' ? 'ໃສ່ລາຄາຂອງແພັກ/ຖົງດຽວໂດຍກົງ' : 'Enter the price of a single pack directly')
                }
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="label-xs">{t('price_original')}</label>
                <input 
                  type="text" 
                  className="crystal-input !text-xs h-[50px] font-mono font-bold"
                  value={displayPrice}
                  placeholder="0"
                  onChange={handlePriceChange}
                />
              </div>
              <div className="space-y-2">
                 <label className="label-xs block mb-1.5">{newPrice.currency !== 'LAK' ? `${t('exchange_rate')} (${newPrice.currency} ➔ LAK)` : 'Exchange Rate (Auto)'}</label>
                 <input 
                   type="number" 
                   disabled={newPrice.currency === 'LAK'}
                   className="w-full h-[50px] px-3 rounded-2xl bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-white border border-slate-200 dark:border-white/10 text-[13px] font-mono font-bold disabled:opacity-30"
                   value={newPrice.currency === 'LAK' ? 1 : (newPrice.exchangeRate || '')}
                   onChange={e => setNewPrice({...newPrice, exchangeRate: parseFloat(e.target.value) || 0})}
                 />
              </div>
            </div>

            <div className="space-y-2">
              <label className="label-xs">{t('remark')}</label>
              <input 
                type="text" 
                className="crystal-input !text-[11px] h-[50px] italic w-full"
                placeholder="Ex. 50,000 / KG or specific batch note..."
                value={newPrice.remark}
                onChange={e => setNewPrice({...newPrice, remark: e.target.value})}
              />
            </div>

            <div className="space-y-2">
                <label className="label-xs">{t('qty_unit')}</label>
                <div className="flex items-center gap-2 h-14">
                  <div className="flex-1 h-full relative">
                    <input 
                      type="number" 
                      className="w-full h-full px-3 pt-4 pb-1 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm font-bold text-center outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      value={newPrice.quantity || ''}
                      placeholder="1"
                      title="Number of units/packs"
                      onChange={e => setNewPrice({...newPrice, quantity: parseFloat(e.target.value) || 0})}
                    />
                    <span className="absolute top-1.5 left-0 right-0 text-center text-[7px] font-black text-slate-400 uppercase tracking-[0.2em] pointer-events-none">Quantity</span>
                  </div>
                  
                  <span className="text-xs font-black text-slate-300">×</span>
                  
                  <div className="flex-1 h-full relative">
                    <input 
                      type="number" 
                      className="w-full h-full px-3 pt-4 pb-1 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm font-bold text-center outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      value={newPrice.quantityPerUnit || ''}
                      placeholder="1"
                      title="Items per pack"
                      onChange={e => setNewPrice({...newPrice, quantityPerUnit: parseFloat(e.target.value) || 0})}
                    />
                    <span className="absolute top-1.5 left-0 right-0 text-center text-[7px] font-black text-slate-400 uppercase tracking-[0.2em] pointer-events-none">Sub-Qty</span>
                  </div>

                  <div className="w-24 h-full relative">
                    <select 
                      className="w-full h-full px-2 pt-4 pb-1 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] uppercase font-black text-center outline-none cursor-pointer hover:bg-white dark:hover:bg-white/10 transition-all shadow-sm appearance-none"
                      value={newPrice.unit}
                      onChange={e => setNewPrice({...newPrice, unit: e.target.value})}
                    >
                      <option value="" className="bg-white dark:bg-slate-800">UNIT</option>
                      <option value="ml" className="bg-white dark:bg-slate-800">ml</option>
                      <option value="g" className="bg-white dark:bg-slate-800">g</option>
                      <option value="pcs" className="bg-white dark:bg-slate-800">pcs</option>
                      <option value="psc" className="bg-white dark:bg-slate-800">psc</option>
                      <option value="unit" className="bg-white dark:bg-slate-800">unit</option>
                      <option value="BOX" className="bg-white dark:bg-slate-800">BOX</option>
                      <option value="PIECE" className="bg-white dark:bg-slate-800">PIECE</option>
                      <option value="PACK" className="bg-white dark:bg-slate-800">PACK</option>
                      <option value="UNIT" className="bg-white dark:bg-slate-800">UNIT</option>
                      <option value="KG" className="bg-white dark:bg-slate-800">KG</option>
                      <option value="BAG" className="bg-white dark:bg-slate-800">BAG</option>
                    </select>
                    <span className="absolute top-1.5 left-0 right-0 text-center text-[7px] font-black text-blue-500/60 uppercase tracking-[0.2em] pointer-events-none">Unit</span>
                  </div>
                </div>
              </div>

            <div className="p-3 bg-[#052659] dark:bg-[#0a3a82] text-white rounded-lg flex justify-between items-center group">
               <div className="flex-1">
                  {(() => {
                    const originalPriceLAK = (newPrice.currency === 'LAK' ? newPrice.priceOriginal : newPrice.priceOriginal * newPrice.exchangeRate);
                    const packPrice = newPrice.priceMode === 'total' 
                      ? originalPriceLAK / (newPrice.quantity || 1) 
                      : originalPriceLAK;
                    const subItemPrice = packPrice / (newPrice.quantityPerUnit || 1);
                    const totalPrice = newPrice.priceMode === 'total' 
                      ? originalPriceLAK 
                      : originalPriceLAK * (newPrice.quantity || 1);

                    return (
                      <>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[#5483B3]">
                          {newPrice.priceMode === 'total' 
                            ? (i18n.language === 'la' ? 'ຄິດໄລ່ເປັນກີບ (ລາຄາທັງໝົດ)' : 'In LAK (Total Cost)') 
                            : (i18n.language === 'la' ? 'ຄິດໄລ່ເປັນກີບ (ລາຄາຕໍ່ແພັກ)' : 'In LAK (Per Pack Cost)')
                          }
                        </p>
                        <p className="text-lg font-bold tracking-tighter">{originalPriceLAK.toLocaleString()} ₭</p>
                        
                        {newPrice.priceOriginal > 0 && (
                          <div className="text-[10px] text-blue-200/90 mt-1.5 space-y-1">
                            <p className="font-bold tracking-tight">
                              {i18n.language === 'la' ? 'ລາຄາຕໍ່ແພັກ/ຕຸກ' : 'Price per pack/unit'}: {Math.round(packPrice).toLocaleString()} ₭
                            </p>
                            {(newPrice.quantityPerUnit || 1) > 1 && (
                              <p className="font-bold tracking-tight opacity-75">
                                {i18n.language === 'la' ? 'ລາຄາຍ່ອຍຕໍ່ຫົວໜ່ວຍ' : 'Price per sub-item'}: {Math.round(subItemPrice).toLocaleString()} ₭
                              </p>
                            )}
                            <p className="font-bold tracking-tight opacity-60">
                              {i18n.language === 'la' ? 'ລາຄາລວມທັງໝົດ' : 'Total Invoice Cost'}: {Math.round(totalPrice).toLocaleString()} ₭
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}
               </div>
               <div className="p-2 bg-white/10 rounded-md ml-2">
                 <Truck className="w-5 h-5 text-[#5483B3]" />
               </div>
            </div>

            <button 
              type="submit" 
              disabled={saveLoading}
              className={`crystal-button w-full h-12 flex items-center justify-center gap-2 ${saveLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {saveLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saveLoading ? 'SYCNING...' : t('commit_record')}
            </button>
          </form>
        </div>

        {/* Product Manager Modal */}
        {showProductManager && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#052659]/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl border border-white/10 flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tighter">Manage Items</h3>
                  <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Edit or Delete your database resources</p>
                  
                  <button 
                    type="button"
                    onClick={() => {
                      setShowMergeModal(true);
                    }}
                    className="mt-3 text-[10px] font-black text-amber-500 hover:text-amber-600 bg-amber-500/10 hover:bg-amber-500/15 py-1 px-3.5 rounded-full cursor-pointer transition flex items-center gap-1.5 self-start shadow-xs animate-pulse"
                  >
                    <span>🔄 ໂຮມສິນຄ້າຊ້ຳຊ້ອນ / Merge Duplicates</span>
                  </button>
                </div>
                <button type="button" onClick={() => setShowProductManager(false)} className="p-2 hover:bg-primary/10 rounded-xl self-start">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                {products.map(p => (
                  <div key={p.id} className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl flex items-center justify-between group">
                    <div className="flex-1 mr-4">
                      {editingProduct?.id === p.id ? (
                        <div className="flex flex-col gap-3 flex-1">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-black uppercase text-slate-400">
                              {i18n.language === 'la' ? 'ຊື່ວັດຖຸດິບ (Name)' : 'Name'}
                            </label>
                            <div className="flex gap-2">
                              <input 
                                autoFocus
                                className="crystal-input !h-10 !text-xs !py-0 flex-1"
                                value={editProductName}
                                onChange={e => setEditProductName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleUpdateProductName(p.id)}
                              />
                              <button 
                                type="button"
                                onClick={() => handleUpdateProductName(p.id)}
                                className="p-2 bg-primary text-white rounded-lg hover:scale-105 transition-transform"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button 
                                type="button"
                                onClick={() => setEditingProduct(null)}
                                className="p-2 bg-slate-200 dark:bg-white/10 rounded-lg hover:scale-105 transition-transform"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1.5 mt-1">
                            <label className="text-[10px] font-black uppercase text-slate-400">
                              {i18n.language === 'la' ? 'ຫົວໜ່ວຍ (Unit)' : 'Unit'}
                            </label>
                            <input 
                              className="crystal-input !h-9 !text-xs !py-0 w-full"
                              placeholder={i18n.language === 'la' ? 'ຕົວຢ່າງ: ml, g, unit, psc, pcs...' : 'e.g. ml, g, unit, psc, pcs...'}
                              value={editProductUnit}
                              onChange={e => setEditProductUnit(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleUpdateProductName(p.id)}
                            />
                            <div className="flex flex-wrap gap-1 mt-1">
                              {['ml', 'g', 'unit', 'pcs', 'psc', 'BAG', 'KG', 'BOX'].map(u => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => setEditProductUnit(u)}
                                  className={`px-2 py-0.5 text-[9px] font-black rounded-md cursor-pointer border transition-all ${
                                    editProductUnit.toLowerCase() === u.toLowerCase()
                                      ? 'bg-sky-500 text-white border-transparent'
                                      : 'bg-white dark:bg-[#052659]/30 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5'
                                  }`}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>

                            {/* Box Packaging Size Input */}
                            <div className="flex flex-col gap-1 mt-3">
                              <label className="text-[10px] font-black uppercase text-slate-400">
                                {i18n.language === 'la' ? 'ຈຳນວນແພັກໃນ 1 ກ່ອງ (Box Packaging Size)' : 'Box Packaging Size (Packs per Box)'}
                              </label>
                              <input 
                                type="number"
                                min="1"
                                className="crystal-input !h-9 !text-xs !py-0 w-full"
                                placeholder="12"
                                value={editProductBoxSize}
                                onChange={e => setEditProductBoxSize(Math.max(1, parseInt(e.target.value) || 1))}
                                onKeyDown={e => e.key === 'Enter' && handleUpdateProductName(p.id)}
                              />
                            </div>

                            <div className="mt-3 p-2 bg-slate-100 dark:bg-black/20 rounded-xl flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                  {i18n.language === 'la' ? 'ເຄື່ອງໃຊ້/ອຸປະກອນ (Durable)' : 'Durable/Equipment Asset'}
                                </span>
                                <span className="text-[9px] text-slate-400">
                                  {i18n.language === 'la' ? 'ເຊັ່ນ ຖາດ, ໄມ້ຕີ, ສະຕິກເກີ້ (ບໍ່ຄິດໄລ່ການເຜົາຜານລາຍວັນ)' : 'e.g. Trays, Whisks, Stickers (no daily burn rate)'}
                                </span>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer select-none">
                                <input 
                                  type="checkbox" 
                                  checked={editProductIsDurable}
                                  onChange={e => setEditProductIsDurable(e.target.checked)}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-slate-200 dark:bg-white/10 rounded-full peer peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                              </label>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-slate-800 dark:text-white">{p.name}</p>
                          {p.isDurable && (
                            <span className="px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-md">
                              {i18n.language === 'la' ? 'ເຄື່ອງໃຊ້/ໝູນວຽນຊ້າ' : 'Durable/Refilled Rarely'}
                            </span>
                          )}
                        </div>
                      )}
                      {editingProduct?.id !== p.id && (
                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{p.unit || 'UNIT'}</p>
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
                          className="p-2 hover:bg-blue-500/10 text-blue-500 rounded-lg"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button 
                          type="button"
                          onClick={() => handleDeleteProduct(p.id)}
                          className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="glass-card bg-white dark:bg-[#052659] text-slate-800 dark:text-white border-none shadow-2xl p-8 relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 dark:bg-white/5 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-700"></div>
           <h4 className="label-xs text-slate-400 dark:text-blue-300/40 mb-6 font-bold italic tracking-wider">ຂໍ້ມຸນຄວາມຄືບໜ້າຜູ້ສະໜອງ • 5 ລາຍການ (Supplier Insights)</h4>
            <div className="space-y-6 relative z-10">
              {finalInsights.map((insight, idx) => renderInsightItem(insight, idx))/*
                <div key={idx} className="flex gap-5 items-start animate-in fade-in slide-in-from-right duration-500" style={{ animationDelay: `${idx * 150}ms` }}>
                  <div className={`w-1.5 h-12 rounded-full mt-1 ${insight.type === 'increase' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-wider ${insight.type === 'increase' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {insight.productName} ({insight.unit}): {insight.type === 'increase' ? 'ລາຄາຂຶ້ນ' : 'ລາຄາລົງ'} {Math.abs(insight.diff).toFixed(1)}%
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-blue-100/60 leading-relaxed mt-2">
                       ສິນຄ້າຈາກ {insight.supplier} ມີການປ່ຽນແປງລາຄາເກີນ 8%. ຈາກ {insight.prevPrice.toLocaleString()} ₭/{insight.unit} ເປັນ {insight.latestPrice.toLocaleString()} ₭/{insight.unit}.
                    </p>
                  </div>
                </div>
              )) : (
                <div className="flex gap-5 items-start opacity-50">
                  <div className="w-1.5 h-12 rounded-full bg-blue-500 mt-1"></div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">ບໍ່ມີການປ່ຽນແປງທີ່ຜິດປົກກະຕິ</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed mt-2">ລະບົບກຳລັງຕິດຕາມການປ່ຽນແປງລາຄາສິນຄ້າຈາກຜູ້ສະໜອງທັງໝົດ.</p>
                  </div>
                </div>
              */}
           </div>
        </div>
      </div>

      {/* List Section */}
      <div className="xl:col-span-2 space-y-6">
        {/* Supplier Price Comparison Widget */}
        <div className="high-density-card bg-white dark:bg-[#052659] p-4 sm:p-6 border border-slate-100 dark:border-white/5 shadow-xl rounded-2xl sm:rounded-3xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-white/10 pb-4">
            <div>
              <h3 className="text-base font-black text-[#052659] dark:text-white tracking-tight flex items-center gap-2">
                <TrendingUp className="text-emerald-500 w-5 h-5 animate-pulse" />
                {i18n.language === 'la' ? 'ລະບົບປຽບທຽບລາຄາກັບ 3 ຜູ້ສະໜອງ' : 'Supplier Price Comparator'}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                {i18n.language === 'la' ? 'ຈັດລຳດັບລາຄາສິນຄ້າ ແລະ ຊອກຫາຮ້ານທີ່ຖືກທີ່ສຸດເພື່ອປະຢັດຕົ້ນທຶນ' : 'Optimize procurement costs across multiple vendors'}
              </p>
            </div>
          </div>

          {supplierComparison.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs font-bold uppercase italic tracking-widest bg-slate-50 dark:bg-white/5 rounded-2xl">
              {i18n.language === 'la' ? 'ບໍ່ມີຂໍ້ມູນປຽບທຽບ, ກະລຸນาບັນທຶກລາຄາສິນຄ້າໃສ່ລະບົບກ່ອນ!' : 'No comparison data. Clear pricing inputs should be registered above first!'}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Product selector panel */}
              <div className="lg:col-span-5 space-y-3 max-h-[350px] overflow-y-auto pr-2 scrollbar-hide">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  {i18n.language === 'la' ? 'ເລືອກສິນຄ້າເພື່ອປຽບທຽບ' : 'Select Product'} ({supplierComparison.length})
                </p>
                {supplierComparison.map((comp) => {
                  const isSelected = selectedCompProduct === comp.productId;
                  return (
                    <button
                      key={comp.productId}
                      type="button"
                      onClick={() => setSelectedCompProduct(comp.productId)}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-all flex flex-col justify-between items-start gap-1.5 ${isSelected ? 'bg-primary/5 dark:bg-[#073069] border-[#073069] dark:border-blue-400/30 ring-2 ring-primary/10' : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/5 hover:bg-slate-100/50 dark:hover:bg-white/10'}`}
                    >
                      <div className="flex w-full justify-between items-center gap-2">
                        <span className="text-xs font-black text-slate-800 dark:text-white truncate">
                          {comp.productName}
                        </span>
                        <span className="text-[9px] font-black tracking-widest uppercase text-slate-400 bg-slate-200/50 dark:bg-white/10 px-2 py-0.5 rounded-md">
                          {comp.unit}
                        </span>
                      </div>
                      <div className="flex w-full justify-between items-center mt-1">
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          {i18n.language === 'la' ? 'ຮ້ານຖືກສຸດ:' : 'Best:'}{' '}
                          <strong className="text-emerald-600 dark:text-emerald-400 font-bold uppercase">{comp.bestSupplier}</strong>
                        </span>
                        {comp.hasComparison && comp.savingsPercent > 0 ? (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 rounded-md">
                            -{comp.savingsPercent.toFixed(0)}% OFF
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-400 bg-slate-200/30 dark:bg-white/5 px-2 py-0.5 rounded-md italic">
                            {i18n.language === 'la' ? 'ມີ 1 ຜູ້ສະໜອງ' : '1 Quote only'}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Advanced Cost Calculator Section */}
              <div className="lg:col-span-7 bg-slate-50 dark:bg-[#041a3c] rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-slate-100 dark:border-white/5 flex flex-col justify-between gap-5">
                {(() => {
                  const compData = supplierComparison.find(c => c.productId === selectedCompProduct);
                  if (!compData) {
                    return (
                      <div className="h-full flex items-center justify-center text-slate-400 text-xs italic p-10">
                        {i18n.language === 'la' ? 'ກະລຸນາເລືອກສິນຄ້າ' : 'Please select a product'}
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      {/* Selection Header */}
                      <div className="flex justify-between items-center bg-white dark:bg-[#073069] rounded-2xl p-3 border border-slate-100 dark:border-white/5 shadow-sm">
                        <div>
                          <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                            {i18n.language === 'la' ? 'ກຳລັງວິເຄາະ' : 'Active Analysis'}
                          </p>
                          <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase mt-0.5">
                            {compData.productName}
                          </h4>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                            {i18n.language === 'la' ? 'ຫົວໜ່ວຍຖານ' : 'Base Unit'}
                          </p>
                          <p className="text-xs font-black text-[#052659] dark:text-blue-400 uppercase mt-0.5">
                            {compData.unit}
                          </p>
                        </div>
                      </div>

                      {/* Quantity Input slider */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            {i18n.language === 'la' ? 'ປະລິມານການສັ່ງຊື້ປຽບທຽບ' : 'Procurement Compare Quantity'}
                          </label>
                          <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 rounded-md font-mono">
                            {purchaseQty.toLocaleString()} {compData.unit}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="1"
                            max="500"
                            className="flex-1 h-2 bg-slate-200 dark:bg-white/10 rounded-lg cursor-pointer"
                            value={purchaseQty}
                            onChange={(e) => setPurchaseQty(parseInt(e.target.value) || 1)}
                          />
                          <div className="flex gap-1.5 animate-fade-in">
                            <button
                              type="button"
                              onClick={() => setPurchaseQty(prev => Math.max(1, prev - 10))}
                              className="px-2.5 py-1 text-[9px] font-black border border-slate-200 dark:border-white/10 bg-white dark:bg-[#073069] rounded-lg hover:bg-slate-50 dark:hover:bg-blue-900/30 transition-colors"
                            >
                              -10
                            </button>
                            <button
                              type="button"
                              onClick={() => setPurchaseQty(prev => Math.min(1000, prev + 10))}
                              className="px-2.5 py-1 text-[9px] font-black border border-slate-200 dark:border-white/10 bg-white dark:bg-[#073069] rounded-lg hover:bg-slate-50 dark:hover:bg-blue-900/30 transition-colors"
                            >
                              +10
                            </button>
                            <button
                              type="button"
                              onClick={() => setPurchaseQty(prev => Math.min(1000, prev + 50))}
                              className="px-2.5 py-1 text-[9px] font-black border border-slate-200 dark:border-white/10 bg-white dark:bg-[#073069] rounded-lg hover:bg-slate-50 dark:hover:bg-blue-900/30 transition-colors"
                            >
                              +50
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Rank Cards */}
                      <div className="space-y-3">
                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">
                          {i18n.language === 'la' ? 'ບົດວິເຄາະ ແລະ ປຽບທຽບຜູ້ສະໜອງ' : 'Supplier Rankings & Cost Discrepancy'}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {compData.rankedSuppliers.slice(0, 3).map((suppQuote: any, rankIdx: number) => {
                            const totalCost = suppQuote.unitPrice * purchaseQty;
                            const isWinner = rankIdx === 0 && compData.hasComparison;
                            const difference = totalCost - (compData.bestPrice * purchaseQty);

                            return (
                              <div
                                key={suppQuote.supplier}
                                className={`p-3.5 rounded-2xl border flex flex-col justify-between transition-all ${isWinner ? 'bg-emerald-500/10 dark:bg-emerald-500/20 border-emerald-500/40 ring-2 ring-emerald-500/5' : 'bg-white dark:bg-slate-800/40 border-slate-100 dark:border-white/5 shadow-sm'}`}
                              >
                                <div className="space-y-1.5">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-slate-100 dark:bg-white/15 text-slate-500 rounded-md font-mono">
                                      Rank {rankIdx + 1}
                                    </span>
                                    {isWinner && (
                                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">🏆</span>
                                    )}
                                  </div>
                                  <h5 className="text-xs font-black dark:text-white uppercase tracking-tight truncate">
                                    {suppQuote.supplier}
                                  </h5>
                                  <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">
                                    {suppQuote.unitPrice.toLocaleString()} ₭/{compData.unit}
                                  </div>
                                </div>

                                <div className="border-t border-slate-100 dark:border-white/5 mt-3 pt-2 space-y-1">
                                  <span className="text-[8px] font-black uppercase tracking-widest text-[#5483B3] block">
                                    Estimated Quote
                                  </span>
                                  <span className="text-xs font-black text-slate-800 dark:text-white block font-mono">
                                    {totalCost.toLocaleString()} ₭
                                  </span>
                                  {rankIdx > 0 && difference > 0 && (
                                    <span className="text-[9px] font-medium text-red-500 block truncate">
                                      +{difference.toLocaleString()} ₭
                                    </span>
                                  )}
                                  {isWinner && (
                                    <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 block truncate animate-pulse uppercase">
                                      {i18n.language === 'la' ? 'ປະຢັດທີ່ສຸດ!' : 'Optimal Choice!'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Best Actions Block & Cumulative Savings Info banner */}
                      {compData.hasComparison && compData.savingsPerUnit > 0 && (
                        <div className="p-3 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-2xl border border-emerald-500/20 flex gap-3 items-center">
                          <div className="p-2 bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-500/20 animate-bounce">
                            <Check className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold leading-tight">
                              {i18n.language === 'la'
                                ? `ແນະນຳໃຫ້ສັ່ງຊື້ຈາກ ${compData.bestSupplier} ເພື່ອປະຢັດຕົ້ນທຶນ`
                                : `Recommendation: Purchase from ${compData.bestSupplier}`}
                            </p>
                            <p className="text-[9px] text-slate-500 mt-1">
                              {i18n.language === 'la'
                                ? `ປະຢັດຄ່າໃຊ້ຈ່າຍຕົ້ນທຶນໄດ້ທັງໝົດສູງສຸດ ${(compData.savingsPerUnit * purchaseQty).toLocaleString()} ₭ ປຽບທຽບກັບຮ້ានທີ່ມີລາຄາແພງທີ່ສຸດ`
                                : `Saves you ${(compData.savingsPerUnit * purchaseQty).toLocaleString()} ₭ compared to purchasing from the most expensive supplier!`}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Optimized Procurement Combined Bills Recommendation */}
        <div className="high-density-card bg-white dark:bg-[#052659] p-4 sm:p-6 border border-slate-100 dark:border-white/5 shadow-xl rounded-2xl sm:rounded-3xl space-y-6 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-white/10 pb-4">
            <div>
              <h3 className="text-base font-black text-[#052659] dark:text-white tracking-tight flex items-center gap-2">
                <ShoppingBag className="text-primary dark:text-blue-400 w-5 h-5" />
                {i18n.language === 'la' ? 'ບິນຈັດຊື້ແບບປະຢັດຕົ້ນທຶນ (Optimized Grouped Purchase Bills)' : 'Optimized Procurement Bills by Supplier'}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                {i18n.language === 'la' ? 'ແນະນຳການລວມບິນສັ່ງຊື້ແຍກຕາມແຕ່ລະຮ້ານ ທີ່ໃຫ້ລາຄາຖືກທີ່ສຸດ ຮັບຮອງການປະຢັດຕົ້ນທຶນສູງສຸດ' : 'Split shopping receipts compiled automatically to secure the best savings per item'}
              </p>
            </div>
          </div>

          {optimizedBills.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase italic tracking-widest bg-slate-50 dark:bg-white/5 rounded-2xl">
              {i18n.language === 'la' ? 'ບໍ່ມີຂໍ້ມູນບິນແນະນຳ, ກະລຸນາບັນທຶກລາຄາສິນຄ້າກ່ອນ!' : 'No recommendations available yet. Fill in some pricing records first!'}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {i18n.language === 'la' ? 'ຄວນແຍກໄປຊື້ສິນຄ້າຕາມແຕ່ລະຮ້ານດັ່ງນີ້ ເພື່ອໃຫ້ໄດ້ລາຄາທີ່ຖືກທີ່ສຸດ:' : 'To get the lowest possible price details, you are recommended to purchase from these stores:'}
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {optimizedBills.map((bill) => (
                  <div 
                    key={bill.supplier} 
                    className="relative overflow-hidden bg-slate-50 dark:bg-[#041a3c] rounded-[2rem] border border-slate-100 dark:border-white/5 shadow-sm p-5 flex flex-col justify-between"
                  >
                    {/* Retro ticket cut receipt top ornament */}
                    <div className="absolute top-0 inset-x-0 h-1.5 flex justify-between gap-1 overflow-hidden opacity-20 dark:opacity-10">
                      {Array.from({ length: 15 }).map((_, i) => (
                        <div key={i} className="w-3 h-3 bg-[#052659] dark:bg-white rounded-full -translate-y-1.5 flex-shrink-0"></div>
                      ))}
                    </div>

                    <div className="pt-2 space-y-4">
                      <div className="flex justify-between items-start border-b border-dashed border-slate-300 dark:border-white/10 pb-3">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-[#5483B3]">
                            {i18n.language === 'la' ? 'ແນະນຳໄປຊື້ຢູ່ຮ້ານ:' : 'Recommended Store:'}
                          </p>
                          <h4 className="text-sm font-black text-[#052659] dark:text-white uppercase tracking-tight mt-0.5 flex items-center gap-1.5">
                            <Receipt className="w-3.5 h-3.5 text-primary dark:text-slate-300" />
                            {bill.supplier}
                          </h4>
                        </div>
                        <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-lg">
                          {bill.totalItems} {bill.totalItems > 1 ? 'items' : 'item'}
                        </span>
                      </div>

                      {/* Bill Items */}
                      <div className="space-y-2.5">
                        {(expandedBills[bill.supplier] ? bill.items : bill.items.slice(0, 5)).map((item) => (
                          <div key={item.productId} className="flex justify-between items-start gap-2">
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                                {item.productName}
                              </span>
                              <span className="text-[8px] uppercase font-black text-slate-400 font-mono tracking-wider">
                                {item.unit}
                              </span>
                            </div>
                            <span className="text-xs font-black text-slate-900 dark:text-slate-100 font-mono flex-shrink-0">
                              {item.price.toLocaleString()} ₭
                            </span>
                          </div>
                        ))}

                        {bill.items.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setExpandedBills(prev => ({ ...prev, [bill.supplier]: !prev[bill.supplier] }))}
                            className="mt-2 w-full text-center py-2.5 border border-dashed border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase text-[#5483B3] hover:text-[#052659] dark:hover:text-blue-300 transition-colors flex items-center justify-center gap-1"
                          >
                            {expandedBills[bill.supplier] ? (
                              <>{i18n.language === 'la' ? 'ສະແດງໜ້ອຍລົງ' : 'See Less'} ↑</>
                            ) : (
                              <>{i18n.language === 'la' ? 'ສະແດງຕື່ມ' : 'See More'} ({bill.items.length - 5}+) ↓</>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Receipt Total estimate */}
                    <div className="border-t border-dashed border-slate-300 dark:border-white/10 mt-5 pt-3 flex justify-between items-center bg-white dark:bg-[#073069] -mx-5 -mb-5 px-5 py-3 rounded-b-[2rem]">
                      <div>
                        <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 block leading-none">
                          Est. Unit Costs Sum
                        </span>
                        <span className="text-xs font-black text-[#052659] dark:text-blue-400 font-mono block mt-1">
                          {bill.items.reduce((sum, current) => sum + current.price, 0).toLocaleString()} ₭
                        </span>
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase italic">
                        {bill.supplier}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="high-density-card p-0 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex justify-between items-center">
            <h4 className="label-xs flex items-center gap-2">
              <BarChart3 className="w-3 h-3 text-primary" />
              Pricing Feed Analysis (ລາຄາທີ່ບັນທຶກລ່າສຸດ)
            </h4>
          </div>
          <div className="p-4 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lastTenPrices}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
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
                    borderRadius: '8px', 
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#fff'
                  }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(val: number) => [`${val.toLocaleString()} ₭`, 'Price']}
                />
                <Bar dataKey="totalLAK" fill="#052659" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Price History Chart Section */}
        {selectedChartProductId && (
          <div className="glass-card bg-white dark:bg-[#052659] p-8 border-none shadow-2xl animate-in slide-in-from-bottom duration-500 overflow-hidden relative mb-6">
            <div className="absolute top-0 right-0 p-4">
              <button 
                onClick={() => setSelectedChartProductId(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
                title="Close Chart"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <h4 className="text-lg font-black text-[#052659] dark:text-white tracking-tight flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  {products.find(p => p.id === selectedChartProductId)?.name}
                </h4>
                <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em] mt-1">
                  ປະຫວັດການປ່ຽນແປງລາຄາ ຕໍ່ ຫົວໜ່ວຍ ({selectedChartUnit || 'ທັງໝົດ'})
                </p>
              </div>
              
              <div className="flex gap-2">
                {Array.from(new Set(supplierPrices.filter(p => p.productId === selectedChartProductId).map(p => p.unit))).map(u => (
                  <button
                    key={u || 'null'}
                    onClick={() => setSelectedChartUnit(u || '')}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${selectedChartUnit === u ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-slate-600 dark:hover:text-white'}`}
                  >
                    {u || 'UNIT'}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" opacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 10, fontWeight: 700, fill: '#94a3b8'}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 10, fontWeight: 700, fill: '#94a3b8'}}
                    tickFormatter={(val) => `${(val/1000).toFixed(0)}k`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 50px rgba(0,0,0,0.1)', fontSize: '12px' }}
                    labelStyle={{ fontWeight: 800, color: '#052659', marginBottom: '4px' }}
                    formatter={(value: number, name: string, props: any) => {
                      return [
                        <div key="tip">
                          <div className="font-black text-blue-600">{value.toLocaleString()} ₭</div>
                          <div className="text-[10px] text-slate-400 uppercase mt-1">Bought as: {props.payload.unitLabel}</div>
                        </div>,
                        'Price per Base Unit'
                      ];
                    }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" />
                  <Line 
                    type="monotone" 
                    dataKey="price" 
                    stroke="#3b82f6" 
                    strokeWidth={4} 
                    dot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 8, strokeWidth: 0 }}
                    name="Unit Price (LAK)"
                    animationDuration={1500}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="high-density-card p-0 flex flex-col min-h-[600px] overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex justify-between items-center sticky top-0 z-10 backdrop-blur-md">
            <div className="flex items-center gap-4">
              <h3 className="label-xs">{t('active_pricing_index')}</h3>
              <button 
                onClick={handleExport}
                className="flex items-center gap-1.5 text-[9px] font-black uppercase text-blue-500 hover:text-blue-600 transition-colors"
                title="Export to CSV"
              >
                <Download className="w-3 h-3" />
                Export CSV
              </button>
              <div className="px-2 py-0.5 bg-primary/10 text-primary dark:bg-blue-400/20 dark:text-blue-400 text-[10px] font-bold rounded flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-primary dark:bg-blue-400 rounded-full animate-pulse"></div>
                {t('live_feed')}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Date Filter Input */}
              <div className="flex items-center gap-1.5 border border-slate-200 dark:border-white/10 p-1 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                <span className="text-[10px] font-black uppercase text-slate-450 dark:text-blue-200/50 tracking-widest pl-1">
                  {i18n.language === 'la' ? 'ວັນທີ:' : 'Date:'}
                </span>
                <input 
                  type="date" 
                  value={selectedFilterDate}
                  onChange={e => setSelectedFilterDate(e.target.value)}
                  className="text-[11px] font-bold font-mono py-0.5 px-1.5 outline-none bg-transparent cursor-pointer text-[#052659] dark:text-blue-300"
                />
                {selectedFilterDate ? (
                  <button 
                    type="button"
                    onClick={() => setSelectedFilterDate('')}
                    className="px-2 py-1 text-[9px] font-black uppercase tracking-widest bg-red-50 hover:bg-red-100 text-red-500 rounded-md transition-all cursor-pointer"
                  >
                    {i18n.language === 'la' ? 'ທັງໝົດ' : 'All'}
                  </button>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setSelectedFilterDate(format(new Date(), 'yyyy-MM-dd'))}
                    className="px-2 py-1 text-[9px] font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-primary dark:text-blue-400 rounded-md transition-all cursor-pointer"
                  >
                    {i18n.language === 'la' ? 'ມື້ນີ້' : 'Today'}
                  </button>
                )}
              </div>

              <div className="relative">
                <input 
                  type="text" 
                  placeholder={t('search_params')} 
                  className="text-[11px] font-medium py-1.5 pl-8 pr-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg outline-none focus:ring-1 focus:ring-primary w-48 shadow-sm transition-all"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                />
                <Search className="absolute left-2.5 top-2.5 w-3 h-3 text-slate-400" />
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-blue-200/40 bg-slate-100/50 dark:bg-white/5">
                <tr>
                  <th className="p-5">{t('transaction_date')}</th>
                  <th className="p-5">{t('resource_identifier')}</th>
                  <th className="p-5">{t('origin_supplier')}</th>
                  <th className="p-5">{t('valuation_lak')}</th>
                  <th className="p-5 text-right">{t('units')}</th>
                  <th className="p-5 text-right">{t('ops')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {sortedSupplierPrices.filter(p => {
                  const prodName = products.find(prod => prod.id === p.productId)?.name || '';
                  const matchesSearch = prodName.toLowerCase().includes(filter.toLowerCase()) || p.supplier.toLowerCase().includes(filter.toLowerCase());
                  const matchesDate = !selectedFilterDate || p.date === selectedFilterDate;
                  return matchesSearch && matchesDate;
                }).map(price => {
                  const item = products.find(p => p.id === price.productId);
                  const isEditing = editingPriceId === price.id;

                  return (
                  <tr key={price.id} className="hover:bg-slate-50 dark:hover:bg-white/10 transition-all duration-300 group">
                    <td className="p-5">
                      <div className="text-[11px] font-bold text-slate-800 dark:text-white uppercase tracking-tight">
                         {price.date ? format(new Date(price.date), 'dd MMM yyyy') : (price.createdAt ? format(price.createdAt.toDate(), 'dd MMM yyyy') : 'Pending...')}
                      </div>
                      <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider italic">
                         {price.time || (price.createdAt ? format(price.createdAt.toDate(), 'HH:mm') : '--:--')}
                      </div>
                    </td>
                    <td className="p-5">
                      <div className="text-[13px] font-bold text-[#052659] dark:text-blue-300 tracking-wide uppercase">
                        {item?.name || 'Unlabeled Resource'}
                      </div>
                      <div className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase flex flex-col gap-1 mt-1.5">
                         <div className="flex items-center gap-2">
                           <div className="w-2 h-[1px] bg-primary/20 dark:bg-white/20"></div>
                           ID: {price.productId?.slice(0, 8) || 'N/A'}
                         </div>
                         {price.remark && (
                            <div className="text-[10px] font-black italic text-pink-500 dark:text-pink-400 mt-1 max-w-[180px] break-words">
                              "{price.remark}"
                            </div>
                         )}
                      </div>
                    </td>
                    <td className="p-5">
                      <span className="px-3 py-1.5 bg-white dark:bg-white/10 text-slate-700 dark:text-white rounded-xl text-[10px] font-bold tracking-wider uppercase border border-slate-200 dark:border-white/20 shadow-sm">
                        {price.supplier}
                      </span>
                    </td>
                    <td className="p-5">
                      {(() => {
                        const isNew = price.totalPriceLAK !== undefined || price.priceMode !== undefined;
                        const totalLAK = isNew
                          ? Number(price.totalPriceLAK || 0)
                          : (price.currency === 'LAK'
                              ? Number(price.priceOriginal || 0)
                              : Number(price.priceOriginal || 0) * Number(price.exchangeRate || 1));
                        const packPrice = isNew
                          ? Number(price.priceLAK || 0)
                          : totalLAK / Number(price.quantity || 1);
                        const baseUnitPrice = packPrice / Number(price.quantityPerUnit || 1);
                        return (
                          <>
                            <div className="text-[13px] font-bold text-slate-900 dark:text-white tracking-tight leading-none animate-fade-in">
                               {totalLAK.toLocaleString()} ₭
                            </div>
                            <div className="flex flex-col gap-1 mt-2">
                              {/* Price per single Pack/Unit */}
                              <div className="text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400/80 uppercase italic tracking-tight flex items-center gap-1">
                                 <Clock className="w-2.5 h-2.5" />
                                 {packPrice.toLocaleString()} ₭ / {price.unit || 'UNIT'}
                              </div>
                              {/* Price per single base/sub item if sub-qty is configured */}
                              {price.quantityPerUnit > 1 && (
                                <div className="text-[9px] font-bold text-cyan-600 dark:text-cyan-400/80 uppercase italic tracking-tight flex items-center gap-1">
                                   <Layers className="w-2.5 h-2.5" />
                                   {baseUnitPrice.toLocaleString()} ₭ / sub-item
                                </div>
                              )}
                              {price.currency !== 'LAK' && (
                                <div className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase italic tracking-widest mt-1">
                                  {price.priceOriginal?.toLocaleString()} {price.currency} @ {price.exchangeRate}
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    <td className="p-5 text-right">
                       <span className="text-[13px] font-bold text-slate-900 dark:text-white">{price.quantity}</span>
                       <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase ml-2 tracking-wider">{price.unit || 'UNIT'}</span>
                       {price.quantityPerUnit > 1 && (
                         <div className="text-[9px] font-bold text-primary dark:text-blue-400 mt-1 uppercase tracking-tighter">
                           ({price.quantity * price.quantityPerUnit} sub-items)
                         </div>
                       )}
                    </td>
                    <td className="p-5 text-right">
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-all">
                        <button 
                          onClick={() => {
                            setSelectedChartProductId(price.productId);
                            setSelectedChartUnit(price.unit || '');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="p-3 text-slate-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-2xl transition-all shadow-sm"
                          title="View History Trend"
                        >
                          <TrendingUp className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => {
                            setEditingPriceId(price.id);
                            // Ensure date is string for input[type="date"]
                            const finalDate = price.date || (price.createdAt ? format(price.createdAt.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
                            setEditPriceData({
                              ...price,
                              date: finalDate,
                              unit: price.unit || item?.unit || ''
                            });
                          }}
                          className="p-3 text-slate-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-2xl transition-all shadow-sm"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            setApprovalType('delete');
                            setPendingAction(price.id);
                            setShowApprovalModal(true);
                          }}
                          className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-2xl transition-all shadow-sm"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );}) }
              </tbody>
            </table>
            
            {supplierPrices.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                <Truck className="w-12 h-12 mb-4 opacity-10" />
                <p className="text-xs font-bold uppercase tracking-widest opacity-40">No records found in active index</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DUPLICATE PRODUCT MERGER AND UNIT STANDARDIZER MODAL */}
      {showMergeModal && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 text-left">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-slate-200 dark:border-white/10 flex flex-col relative text-left">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-1.5">
                  <span>🔄 ໂຮມສິນຄ້າ & ແກ້ໄຂສິນຄ້າຊ້ຳຊ້ອນ</span>
                </h3>
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-1">
                  {i18n.language === 'la' ? 'ແກ້ໄຂສິນຄ້າຂຽນຕ່າງກັນ ແລະ ຫົວໜ່ວຍຕ່າງກັນ' : 'Merge Spell Mismatches & Convert Units'}
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowMergeModal(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-5 text-xs text-slate-600 dark:text-slate-300 text-left">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[11px] leading-relaxed text-amber-600 dark:text-amber-400 font-bold">
                {i18n.language === 'la' ? (
                  <span>💡 ຫຼັງຈາກໂຮມສິນຄ້າ: ປະຫວັດລາຄາຂອງສິນຄ້າເກົ່າ ຈະຍ້າຍໄປຫາສິນຄ້າໃໝ່ອັດຕະໂນມັດ <b>ເຮັດໃຫ້ລະບົບດຶງລາຄາຈາກ Supplier ໄດ້ຢ່າງຖືກຕ້ອງ</b>!</span>
                ) : (
                  <span>💡 After merging, historical quotes from the old spelling will migrate to the kept product. <b>This guarantees correct supplier price retrieval!</b></span>
                )}
              </div>

              {/* 1. SELECT SOURCE PRODUCT (TO DELETE AND REMOVE) */}
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  {i18n.language === 'la' ? '1. ເລືອກສິນຄ້າເກົ່າ (ທີ່ຈະລົບອອກ)' : '1. Select Duplicate Product (To Delete)'}
                </label>
                <select
                  className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold outline-none"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                >
                  <option value="">-- {i18n.language === 'la' ? 'ເລືອກ' : 'Select'} --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit || 'g'})</option>
                  ))}
                </select>
              </div>

              {/* 2. SELECT TARGET PRODUCT (TO KEEP) */}
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  {i18n.language === 'la' ? '2. ເລືອກສິນຄ້າຫຼັກ (ທີ່ຈະເກັບໄວ້)' : '2. Select Primary Product (To Keep)'}
                </label>
                <select
                  className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold outline-none"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                >
                  <option value="">-- {i18n.language === 'la' ? 'ເລືອກ' : 'Select'} --</option>
                  {products.filter(p => p.id !== mergeSourceId).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit || 'g'})</option>
                  ))}
                </select>
              </div>

              {/* 3. CONVERSION MULTIPLIER (CONVERT UNIT) */}
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">
                  {i18n.language === 'la' ? '3. ປັດໄຈຄູນປ່ຽນຫົວໜ່ວຍ (Unit Conversion Multiplier)' : '3. Unit Conversion Multiplier'}
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    className="w-24 p-2.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-center font-mono font-bold text-xs"
                    value={mergeMultiplier}
                    onChange={(e) => setMergeMultiplier(parseFloat(e.target.value) || 1)}
                  />
                  <div className="flex-1 text-[11px] leading-tight text-slate-400 font-bold text-left">
                    {i18n.language === 'la' ? (
                      <span>ຕົວຢ່າງ: ຖ້າປ່ຽນຈາກ KG ➔ G ໃຫ້ໃສ່ <b>1000</b>. ຖ້າປ່ຽນຈາກ ຖົງ ➔ G ໃຫ້ໃສ່ ນ້ຳໜັກຕໍ່ຖົງ. ຖ້າຫົວໜ່ວຍດຽວກັນແລ້ວໃຫ້ໃສ່ <b>1</b>.</span>
                    ) : (
                      <span>e.g., if converting KG ➔ G, input <b>1000</b>. If converting L ➔ ML, input <b>1000</b>. Otherwise, just keep it as <b>1</b>.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 mt-8">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-2xl font-black text-xs uppercase cursor-pointer"
              >
                {i18n.language === 'la' ? 'ຍົກເລີກ' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isMerging || !mergeSourceId || !mergeTargetId}
                onClick={handleMergeProducts}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-2xl font-black text-xs uppercase cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20"
              >
                {isMerging ? (
                  <span>Processing...</span>
                ) : (
                  <span>{i18n.language === 'la' ? 'ໂຮມສິນຄ້າ' : 'Merge Now'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🚀 GRAND SUPPLIER PRICE MODIFIER MODAL (LARGE LAYOUT POPUP) */}
      {editingPriceId && editPriceData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-950/80 backdrop-blur-lg animate-in fade-in duration-200 text-left">
          <div className="bg-white dark:bg-[#073069] w-full max-w-2xl rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-white/10 flex flex-col overflow-hidden max-h-[92vh] animate-in zoom-in-95 duration-200">
            
            {/* Header branding */}
            <div className="p-6 md:p-8 bg-slate-50 dark:bg-white/5 border-b border-secondary/10 dark:border-white/5 flex items-center justify-between">
              <div>
                <span className="px-2.5 py-1 bg-amber-500/10 text-amber-500 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {i18n.language === 'la' ? 'ແກ້ໄຂລາຄາ' : 'SECURE PRICING EDIT'}
                </span>
                <h3 className="text-lg md:text-xl font-black text-[#052659] dark:text-white uppercase tracking-tight flex items-center gap-2 mt-1">
                  <Edit3 className="w-5 h-5 text-blue-500" />
                  <span>{i18n.language === 'la' ? 'ປັບປຸງຂໍ້ມູນລາຄາຜູ້ສະໜອງ' : 'Modify Supplier Price Record'}</span>
                </h3>
                <p className="text-[10px] font-bold text-slate-450 dark:text-slate-400 uppercase tracking-widest mt-1">
                  {i18n.language === 'la' ? 'ປັບປຸງການບັນທຶກລາຄາ, ຫົວໜ່ວຍ ແລະ ຂໍ້ມູນຜູ້ສະໜອງສິນຄ້າ' : 'Update record details, currencies, and packing volume ratios'}
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setEditingPriceId(null);
                  setEditPriceData(null);
                }}
                className="p-2 bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 rounded-2xl cursor-pointer transition"
              >
                <X className="w-6 h-6 text-slate-400 hover:text-red-500 transition-colors" />
              </button>
            </div>

            {/* Scrollable Form parameters */}
            <form onSubmit={(e) => { e.preventDefault(); handleUpdatePrice(); }} className="p-6 md:p-8 overflow-y-auto space-y-6 text-xs text-slate-700 dark:text-slate-300">
              
              {/* Product Association & Date Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* 1. Associated Raw Product */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider">
                    {i18n.language === 'la' ? 'ວັດຖຸດິບ / ສິນຄ້າຫຼັກ' : 'Target Product (Raw Material)'}
                  </label>
                  <select
                    className="w-full p-3 md:p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold outline-none cursor-pointer text-slate-800 dark:text-white"
                    value={editPriceData.productId}
                    onChange={e => setEditPriceData({...editPriceData, productId: e.target.value})}
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.unit || 'g'})</option>
                    ))}
                  </select>
                </div>

                {/* 2. Transaction date */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider">
                    {i18n.language === 'la' ? 'ວັນທີຊື້ / Purchase Date' : 'Purchase Date'}
                  </label>
                  <input 
                    type="date"
                    required
                    className="w-full p-3 md:p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold font-mono outline-none text-slate-800 dark:text-white"
                    value={editPriceData.date}
                    onChange={e => setEditPriceData({...editPriceData, date: e.target.value})}
                  />
                </div>

              </div>

              {/* Supplier Selection Widget */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider block">
                  {i18n.language === 'la' ? 'ຜູ້ສະໜອງ / Supplier Name' : 'Supplier Name / Vendor'}
                </label>
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1">
                    <input 
                      type="text"
                      required
                      placeholder={i18n.language === 'la' ? 'ປ້ອນຊື່ຜູ້ສະໜອງ...' : 'Enter custom or choose preset below...'}
                      className="w-full p-3 md:p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-bold outline-none text-slate-800 dark:text-white"
                      value={editPriceData.supplier}
                      onChange={e => setEditPriceData({...editPriceData, supplier: e.target.value})}
                    />
                  </div>
                  
                  {/* Preset Pills to quickly set */}
                  <div className="flex flex-wrap items-center gap-1.5 self-center">
                    {['LATDA', 'CHANHOM', 'HEAVENLY', 'DMART', 'MARRY ANN'].map(sup => (
                      <button
                        key={sup}
                        type="button"
                        onClick={() => setEditPriceData({...editPriceData, supplier: sup})}
                        className={`px-3 py-1.5 text-[9px] font-black rounded-full cursor-pointer transition border ${
                          editPriceData.supplier === sup
                            ? 'bg-blue-600 text-white border-transparent'
                            : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
                        }`}
                      >
                        {sup}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Price & Currency bento row */}
              <div className="bg-slate-50/50 dark:bg-white/5 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-white/5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Original valuation quantity */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider">
                      {i18n.language === 'la' ? 'ລາຄາເດີມ / Original Price' : 'Original Sticker Price'}
                    </label>
                    <input 
                      type="number"
                      step="any"
                      min="0"
                      required
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white"
                      value={editPriceData.priceOriginal}
                      onChange={e => setEditPriceData({...editPriceData, priceOriginal: parseFloat(e.target.value) || 0})}
                    />
                  </div>

                  {/* Currency selector */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider">
                      {i18n.language === 'la' ? 'ສະກຸນເງິນ / Currency' : 'Purchase Currency'}
                    </label>
                    <select
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#052659] text-xs font-bold outline-none text-slate-800 dark:text-white"
                      value={editPriceData.currency}
                      onChange={e => setEditPriceData({...editPriceData, currency: e.target.value})}
                    >
                      <option value="LAK">LAK (₭)</option>
                      <option value="THB">THB (฿)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>

                  {/* Exchange rate factor */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider">
                      {i18n.language === 'la' ? 'ອັດຕາແລກປ່ຽນ / Exchange Rate' : 'Exchange Rate (to LAK)'}
                    </label>
                    <input 
                      type="number"
                      step="any"
                      min="0.0001"
                      disabled={editPriceData.currency === 'LAK'}
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#052659] disabled:opacity-40 text-xs font-mono font-bold text-slate-800 dark:text-white"
                      value={editPriceData.currency === 'LAK' ? 1 : editPriceData.exchangeRate}
                      onChange={e => setEditPriceData({...editPriceData, exchangeRate: parseFloat(e.target.value) || 1})}
                    />
                  </div>

                </div>

                {/* Sub-calculation summary indicator */}
                {editPriceData.currency !== 'LAK' && (
                  <div className="text-[11px] font-black text-blue-500 flex justify-between items-center bg-blue-500/10 p-3 rounded-2xl">
                    <span>💵 {i18n.language === 'la' ? 'ຄິດໄລ່ເງິນກີບທຽບເທົ່າ:' : 'Calculated equivalent LAK value:'}</span>
                    <span className="font-mono text-xs font-black">
                      {((editPriceData.priceOriginal || 0) * (editPriceData.exchangeRate || 1)).toLocaleString()} ₭
                    </span>
                  </div>
                )}
              </div>

              {/* Quantities & Pack sizes details */}
              <div className="bg-slate-50/50 dark:bg-white/5 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-white/5 space-y-4">
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest block">
                  📦 {i18n.language === 'la' ? 'ອັດຕາສ່ວນການບັນຈຸ ແລະ ຫົວໜ່ວຍສິນຄ້າ' : 'Pack Volume & Material Sub-Units'}
                </span>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Total pack volume Qty */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-500">
                      {i18n.language === 'la' ? 'ຈຳນວນແພັກ (Qty Purchased)' : 'Pack/Bulk Qty'}
                    </label>
                    <input 
                      type="number"
                      step="any"
                      min="0"
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white text-center"
                      value={editPriceData.quantity}
                      onChange={e => setEditPriceData({...editPriceData, quantity: parseFloat(e.target.value) || 0})}
                    />
                  </div>

                  {/* Quantity per single unit item */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-500">
                      {i18n.language === 'la' ? 'ຂະໜາດຕໍ່ແພັກ (Vol / Pack)' : 'Qty Per Pack/Unit'}
                    </label>
                    <input 
                      type="number"
                      step="any"
                      min="1"
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#052659] text-xs font-mono font-bold text-slate-800 dark:text-white text-center"
                      value={editPriceData.quantityPerUnit || 1}
                      onChange={e => setEditPriceData({...editPriceData, quantityPerUnit: parseFloat(e.target.value) || 1})}
                    />
                  </div>

                  {/* Logical item Unit choice */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-500">
                      {i18n.language === 'la' ? 'ຫົວໜ່ວຍ (Packing Unit)' : 'Packing Unit'}
                    </label>
                    <select
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#052659] text-xs font-bold outline-none text-slate-800 dark:text-white"
                      value={editPriceData.unit}
                      onChange={e => setEditPriceData({...editPriceData, unit: e.target.value})}
                    >
                      <option value="ml">ml</option>
                      <option value="g">g</option>
                      <option value="pcs">pcs</option>
                      <option value="psc">psc</option>
                      <option value="unit">unit</option>
                      <option value="BOX">BOX</option>
                      <option value="PIECE">PIECE</option>
                      <option value="PACK">PACK</option>
                      <option value="UNIT">UNIT</option>
                      <option value="KG">KG</option>
                      <option value="BAG">BAG</option>
                    </select>
                  </div>

                </div>

                {/* Calculation indicator */}
                <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex justify-between items-center bg-emerald-500/10 p-3 rounded-2xl">
                  <span>📊 {i18n.language === 'la' ? 'ຍອດສິນຄ້າເຂົ້າສາງທັງໝົດ:' : 'Total net volume received into inventory:'}</span>
                  <span className="font-mono text-xs font-black">
                    {((editPriceData.quantity || 1) * (editPriceData.quantityPerUnit || 1)).toLocaleString()} {editPriceData.unit || 'UNIT'}
                  </span>
                </div>
              </div>

              {/* Memo / Remark text field */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-450 dark:text-slate-400 tracking-wider">
                  {i18n.language === 'la' ? 'ໝາຍເຫດເພີ່ມເຕີມ / Record Memo' : 'Purchase Memo / Context Remark'}
                </label>
                <input 
                  type="text"
                  placeholder={i18n.language === 'la' ? 'ຕົວຢ່າງ: ແຖມແກ້ວຟຣີ, ສົ່ງດ່ວນພິເສດ...' : 'e.g. Bulk discount negotiated, premium quality...'}
                  className="w-full p-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#052659] text-xs font-medium outline-none text-slate-800 dark:text-white"
                  value={editPriceData.remark || ''}
                  onChange={e => setEditPriceData({...editPriceData, remark: e.target.value})}
                />
              </div>

            </form>

            {/* CTA action buttons */}
            <div className="p-6 md:p-8 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditingPriceId(null);
                  setEditPriceData(null);
                }}
                className="flex-1 py-3.5 bg-slate-200 hover:bg-slate-300 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-3xl font-black text-xs uppercase cursor-pointer text-center transition"
              >
                {i18n.language === 'la' ? 'ຍົກເລີກ' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={saveLoading}
                onClick={handleUpdatePrice}
                className="flex-1 py-3.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-3xl font-black text-xs uppercase cursor-pointer text-center transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
              >
                {saveLoading ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{i18n.language === 'la' ? 'ບັນທຶກການແກ້ໄຂ' : 'Save Changes'}</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* PRICE INSIGHT COMPARATIVE DETAIL MODAL */}
      {selectedInsight && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto text-slate-800 dark:text-slate-100">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-5 md:p-6 max-w-xl w-full max-h-[95vh] flex flex-col justify-between shadow-2xl relative">
            <button
              type="button"
              onClick={() => setSelectedInsight(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full"
            >
              <span className="text-lg font-bold font-mono">×</span>
            </button>

            <div className="space-y-4 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {i18n.language === 'la' ? 'ລາຍລະອຽດການວິເຄາະລາຄາ' : 'Price Insight Analysis Detail'}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    {selectedInsight.productName} ({selectedInsight.unit})
                  </p>
                </div>
              </div>

              {/* Top Banner percentage */}
              <div className={`p-4 rounded-2xl flex items-center justify-between ${
                selectedInsight.type === 'increase' 
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400' 
                  : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              }`}>
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-widest">
                    {i18n.language === 'la' ? 'ການປ່ຽນແປງລາຄາ' : 'Price Difference'}
                  </p>
                  <p className="text-[10px] opacity-80 mt-0.5">
                    {i18n.language === 'la' ? 'ຄິດໄລ່ທຽບໃບບິນຫຼ້າສຸດກັບໃບບິນກ່ອນໜ້າ' : 'Calculated compared to the previous invoice'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black font-mono">
                    {selectedInsight.type === 'increase' ? '▲ +' : '▼ -'}
                    {Math.abs(selectedInsight.diff).toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Side by side cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* PREVIOUS RECORD */}
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5 space-y-3 text-left">
                  <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/5 pb-2">
                    <span className="text-[10px] font-black uppercase text-slate-400">
                      {i18n.language === 'la' ? 'ບິນເກົ່າກ່ອນໜ້າ' : 'Previous Entry'}
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-200 dark:bg-white/10 rounded-md text-slate-600 dark:text-slate-355">
                      {selectedInsight.prevRecord?.date ? selectedInsight.prevRecord.date.split('-').reverse().join('/') : 'Unknown'}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-405 dark:text-slate-400">{i18n.language === 'la' ? 'ຜູ້ສະໜອງ:' : 'Supplier:'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedInsight.prevRecord?.supplier || 'N/A'}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-405 dark:text-slate-400">{i18n.language === 'la' ? 'ລາຄາທີ່ປ້ອນ:' : 'Entered Cost:'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                        {selectedInsight.prevRecord?.priceOriginal?.toLocaleString()} {selectedInsight.prevRecord?.currency || 'LAK'}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-405 dark:text-slate-400">{i18n.language === 'la' ? 'ຈຳນວນແພັກຈິງ:' : 'Quantity (Pack):'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {selectedInsight.prevRecord?.quantity || 1} 
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-402 dark:text-slate-400">{i18n.language === 'la' ? 'ຍ່ອຍໃນແພັກ:' : 'Sub-items per Pack:'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {selectedInsight.prevRecord?.quantityPerUnit || 1}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-dashed border-slate-200 dark:border-white/5 flex justify-between items-center">
                      <span className="text-[10px] font-black text-slate-500 uppercase">{i18n.language === 'la' ? 'ລາຄາສະເລ່ຍຕໍ່ໜ່ວຍ:' : 'Calc Unit Price:'}</span>
                      <span className="text-xs font-black text-[#052659] dark:text-emerald-400 font-mono">
                        {Math.round(selectedInsight.prevPrice).toLocaleString()} ₭
                      </span>
                    </div>
                  </div>
                </div>

                {/* LATEST RECORD */}
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5 space-y-3 text-left">
                  <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/5 pb-2">
                    <span className="text-[10px] font-black uppercase text-blue-500">
                      {i18n.language === 'la' ? 'ບິນຫຼ້າສຸດ' : 'Latest Entry'}
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-500/15 rounded-md text-blue-500">
                      {selectedInsight.latestRecord?.date ? selectedInsight.latestRecord.date.split('-').reverse().join('/') : 'Unknown'}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-405 dark:text-slate-400">{i18n.language === 'la' ? 'ຜູ້ສະໜອງ:' : 'Supplier:'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedInsight.latestRecord?.supplier || 'N/A'}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-405 dark:text-slate-400">{i18n.language === 'la' ? 'ລາຄາທີ່ປ້ອນ:' : 'Entered Cost:'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                        {selectedInsight.latestRecord?.priceOriginal?.toLocaleString()} {selectedInsight.latestRecord?.currency || 'LAK'}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-405 dark:text-slate-400">{i18n.language === 'la' ? 'ຈຳນວນແພັກຈິງ:' : 'Quantity (Pack):'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {selectedInsight.latestRecord?.quantity || 1}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-402 dark:text-slate-400">{i18n.language === 'la' ? 'ຍ່ອຍໃນແພັກ:' : 'Sub-items per Pack:'}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {selectedInsight.latestRecord?.quantityPerUnit || 1}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-dashed border-slate-200 dark:border-white/5 flex justify-between items-center">
                      <span className="text-[10px] font-black text-slate-500 uppercase">{i18n.language === 'la' ? 'ລາຄາສະເລ່ຍຕໍ່ໜ່ວຍ:' : 'Calc Unit Price:'}</span>
                      <span className="text-xs font-black text-[#052659] dark:text-emerald-400 font-mono">
                        {Math.round(selectedInsight.latestPrice).toLocaleString()} ₭
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Explanation of difference */}
              <div className="p-4 bg-blue-500/5 dark:bg-white/5 rounded-2xl text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 space-y-2 text-left">
                <p className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                  <span>💡</span>
                  {i18n.language === 'la' ? 'ວິທີການຄິດໄລ່ເປຽບທຽບຂອງລະບົບ:' : 'Comparative Calculation Logic Explained:'}
                </p>
                <p>
                  {i18n.language === 'la' 
                    ? 'ລະບົບນຳໃຊ້ "ລາຄາມາດຕະຖານຕໍ່ໜ່ວຍຍ່ອຍ" (Standardized Unit Price) ເພື່ອທຽບໃຫ້ຖືກຕ້ອງທີ່ສຸດ ເຖິງແມ່ນວ່າຈະຊື້ເປັນແພັກນ້ອຍ, ແພັກໃຫຍ່ຕ່າງກັນ, ຫຼື ຊື້ໃນປະລິມານທີ່ບໍ່ຄືກັນ. ສູດຄິດໄລ່ແມ່ນ:'
                    : 'The system converts everything into Standardized Unit Price (e.g. per piece, per bottle, etc.) to accurately compare cost rises or drops even if package configurations or purchase quantities differ. Formula:'}
                </p>
                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[9.5px] text-center font-bold">
                  {i18n.language === 'la' 
                    ? 'ລາຄາຕໍ່ຫນ່ວຍ = ລາຄາແພັກ LAK ÷ ຈຳນວນຍ່ອຍໃນແພັກ'
                    : 'Unit Price = LAK Pack Price ÷ Sub-items per Pack'}
                </div>
                <p>
                  {i18n.language === 'la'
                    ? `ໃນກໍລະນີນີ້, ບິນກ່ອນໜ້າແມ່ນຂອງ ${selectedInsight.prevRecord?.supplier || 'N/A'} (ວັນທີ ${selectedInsight.prevRecord?.date ? selectedInsight.prevRecord.date.split('-').reverse().join('/') : 'N/A'}) ໂດຍມີລາຄາຫົວໜ່ວຍຍ່ອຍ ${Math.round(selectedInsight.prevPrice).toLocaleString()} ₭, ສ່ວນບິນຫຼ້າສຸດແມ່ນຂອງ ${selectedInsight.latestRecord?.supplier || 'N/A'} (ວັນທີ ${selectedInsight.latestRecord?.date ? selectedInsight.latestRecord.date.split('-').reverse().join('/') : 'N/A'}) ໂດຍມີລາຄາຫົວໜ່ວຍຍ່ອຍ ${Math.round(selectedInsight.latestPrice).toLocaleString()} ₭.`
                    : `Here, the previous unit rate is ${Math.round(selectedInsight.prevPrice).toLocaleString()} ₭ (from ${selectedInsight.prevRecord?.supplier || 'N/A'} on ${selectedInsight.prevRecord?.date ? selectedInsight.prevRecord.date.split('-').reverse().join('/') : 'N/A'}), whereas the latest rate is ${Math.round(selectedInsight.latestPrice).toLocaleString()} ₭ (from ${selectedInsight.latestRecord?.supplier || 'N/A'} on ${selectedInsight.latestRecord?.date ? selectedInsight.latestRecord.date.split('-').reverse().join('/') : 'N/A'}).`
                  }
                </p>
                <p className="text-[10px] text-emerald-500 font-bold">
                  {i18n.language === 'la'
                    ? `➔ ດັ່ງນັ້ນ, ລະບົບຈຶ່ງປຽບທຽບລາຄາຫົວໜ່ວຍຕົວຈິງເພື່ອຊ່ວຍທ່ານວິເຄາະຕົ້ນທຶນໄດ້ຖືກຕ້ອງ ແລະ ຊັດເຈນທີ່ສຸດ.`
                    : `➔ Therefore, the system directly compares the real per-unit rate to provide you with the most accurate cost trend analysis possible.`
                  }
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-white/5 mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedInsight(null)}
                className="px-5 py-2.5 bg-[#052659] text-white dark:bg-slate-100 dark:text-slate-900 font-bold text-[10px] uppercase rounded-xl cursor-pointer hover:bg-slate-800 transition-colors"
              >
                {i18n.language === 'la' ? 'ປິດໜ້າຕ່າງ' : 'Close Detail'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMPACT DATA ENTRY & ESTIMATOR GUIDE MODAL */}
      {isHelpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto text-slate-800 dark:text-slate-100">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-5 md:p-6 max-w-lg w-full max-h-[90vh] flex flex-col justify-between shadow-2xl relative">
            <button
              type="button"
              onClick={() => setIsHelpModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full"
            >
              <span className="text-lg font-bold font-mono">×</span>
            </button>

            <div className="space-y-4 flex-1 overflow-y-auto pr-1">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {i18n.language === 'la' ? 'ຄູ່ມື ແລະ ວິທີໃຊ້ລະບົບຜູ້ສະໜອງ' : 'Supplier Guide & Pricing Modes'}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    {i18n.language === 'la' ? 'ວິທີປ້ອນລາຄາ & ລະບົບສົມທຽບ 3 ຜູ້ສະໜອງ' : 'How to manage inputs & comparative savings'}
                  </p>
                </div>
              </div>

              <div className="space-y-4 text-xs">
                {/* 1. Pricing Entry Mode Explained */}
                <div className="p-4 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 rounded-xl space-y-1.5">
                  <h3 className="font-extrabold text-[#052659] dark:text-emerald-400 text-xs flex items-center gap-1.5">
                    <span>💵</span>
                    {i18n.language === 'la' ? 'ການປ້ອນລາຄາ: ລາຄາລວມ VS ລາຄາຕໍ່ແພັກ' : 'Price Input: Total vs Price per Pack'}
                  </h3>
                  <p className="text-slate-605 dark:text-slate-300 leading-relaxed text-[11px]">
                    {i18n.language === 'la' 
                      ? 'ທ່ານບໍ່ຈຳເປັນຕ້ອງປ້ອນທັງສອງຊ່ອງ! ພຽງແຕ່ເລືອກຮູບແບບທີ່ທ່ານສະດວກ:'
                      : 'You do NOT have to fill both fields! Just choose your preferred dynamic mode:'}
                  </p>
                  <ul className="space-y-1 list-disc list-inside text-slate-550 dark:text-slate-400 text-[10.5px]">
                    <li>
                      <strong>{i18n.language === 'la' ? 'ລາຄາລວມ (Total Price):' : 'Total Price Mode:'}</strong> {i18n.language === 'la' ? 'ປ້ອນລາຄາທັງໝົດໃນບິນ. ລະບົບຈະໄປຫານໃຫ້ຈຳນວນເພື່ອຫາລາຄາຕໍ່ແພັກໃຫ້ເອງ.' : 'Enter the complete invoice subtotal. The system immediately divides it by Quantity to compute the per-unit price.'}
                    </li>
                    <li>
                      <strong>{i18n.language === 'la' ? 'ລາຄາຕໍ່ແພັກ (Price per Pack):' : 'Price per Pack Mode:'}</strong> {i18n.language === 'la' ? 'ປ້ອນລາຄາຕໍ່ຖົງ/ຕຸກດຽວໂດຍກົງ. ລະບົບຈະຄູນໃຫ້ຈຳນວນເພື່ອຫາລາຄາລວມໃຫ້ເອງ.' : 'Enter the price of a single bulk item. The system automatically computes the total sum dynamically.'}
                    </li>
                  </ul>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                    💡 {i18n.language === 'la' ? '➔ ແນະນຳ: ປ້ອນພຽງຊ່ອງດຽວທີ່ກົງກັບໃບເກັບເງິນກໍພໍແລ້ວ!' : '➔ Tip: Only fill one option based on your billing sheet details!'}
                  </p>
                </div>

                {/* 2. 3-Supplier Comparison Engine */}
                <div className="p-4 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/10 rounded-xl space-y-1.5">
                  <h3 className="font-extrabold text-[#052659] dark:text-blue-400 text-xs flex items-center gap-1.5">
                    <span>📊</span>
                    {i18n.language === 'la' ? 'ປະໂຫຍດຂອງລະບົບສົມທຽບ 3 ຜູ້ສະໜອງ' : 'Why Use 3-Supplier Price Comparison?'}
                  </h3>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[11px]">
                    {i18n.language === 'la'
                      ? 'ເມື່ອທ່ານປ້ອນລາຄາ, ລະບົບຈະປ່ຽນທຸກລະດັບการຊື້ໃຫ້ເປັນ "ລາຄາສະເລ່ຍຕໍ່ຫົວໜ່ວຍຍ່ອຍ" (ເຊັ່ນ ຕໍ່ກຣາມ, ຕໍ່ ມລ) ລະຫວ່າງຜູ້ສະໜອງແຂ່ງຂັນກັນ (LATDA, CHANHOM, HEAVENLY, DMART, MARRY ANN):'
                      : 'When prices are saved, the system standardizes bulk pricing into small units (grams, ml, etc.) across top contenders:'}
                  </p>
                  <ul className="space-y-1 list-disc list-inside text-slate-550 dark:text-slate-400 text-[10.5px]">
                    <li>{i18n.language === 'la' ? 'ສະແດງຜູ້ສະໜອງທີ່ຖືກທີ່ສຸດຢູ່ເທິງສຸດສະເໝີ.' : 'Always ranks and highlights the absolute lowest cost path.'}</li>
                    <li>{i18n.language === 'la' ? 'ຄິດໄລ່ເປີເຊັນ ແລະ ຍອດເງິນທີ່ປະຢັດໄດ້ໃນທັນທີ.' : 'Displays instantaneous savings margin percentages.'}</li>
                    <li>{i18n.language === 'la' ? 'ຊ່ວຍຈັດວັດຖຸດິບແບ່ງຕາມໃບບິນແຍກຜູ້ສະໜອງອັດຕະໂນມັດ ຕອນ Restock!' : 'Splits bulk procurement plans into clean, supplier-specific Restock bills.'}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-white/5 mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setIsHelpModalOpen(false)}
                className="px-4 py-2 bg-[#052659] text-white dark:bg-slate-100 dark:text-slate-900 font-bold text-[10px] uppercase rounded-xl cursor-pointer hover:bg-slate-800 transition-colors"
              >
                {i18n.language === 'la' ? 'ເຂົ້າໃຈແລ້ວ • ປິດ' : 'Got it! Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
