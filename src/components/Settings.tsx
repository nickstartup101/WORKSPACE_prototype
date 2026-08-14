import { useState, useEffect, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, ShieldCheck, Database, FileText, Lock, Key, Layout, Users, Trash2, Plus, LogOut, Check, X, Upload } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, setDoc, serverTimestamp, collection, query, onSnapshot, deleteDoc, getDocs, addDoc, where, orderBy, limit } from 'firebase/firestore';
import { format } from 'date-fns';
import { read, utils } from 'xlsx';

// Premium Text Logo Component (matches App.tsx)
const TextLogoPreview = ({ dark = false, name = "La Dolce" }: { dark?: boolean, name?: string }) => (
  <div className={`flex flex-col items-center text-center gap-2 group`}>
    <h1 className={`text-3xl font-alice tracking-tight leading-none ${dark ? 'text-white' : 'text-[#052659] dark:text-white'}`}>
      {name}
    </h1>
    
    <div className="flex items-center justify-center gap-2 w-full">
      <div className={`h-[0.5px] flex-1 min-w-[8px] opacity-20 ${dark ? 'bg-white' : 'bg-[#052659]'}`}></div>
      <span className={`text-[7px] font-sans font-black uppercase tracking-[0.4em] ${dark ? 'text-white/60' : 'text-[#052659]/60 dark:text-white/40'}`}>
        Workspace
      </span>
      <div className={`h-[0.5px] flex-1 min-w-[8px] opacity-20 ${dark ? 'bg-white' : 'bg-[#052659]'}`}></div>
    </div>
    
    <div className={`text-[6px] font-sans font-bold uppercase tracking-[0.6em] opacity-30 mt-0.5 ${dark ? 'text-white' : 'text-[#052659] dark:text-white'}`}>
       estd 2026
    </div>
  </div>
);

export default function Settings({ user, isDarkMode, setIsDarkMode, userSettings, isSuperAdmin, appConfig, selectedBranch }: any) {
  const { t, i18n } = useTranslation();
  const [newPin, setNewPin] = useState('');
  const [oldPinConfirm, setOldPinConfirm] = useState('');
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [sheetsId, setSheetsId] = useState(userSettings?.googleSheetsId || '');
  const [logoUrl, setLogoUrl] = useState(appConfig?.logoUrl || userSettings?.logoUrl || '');
  const [shopName, setShopName] = useState(appConfig?.shopName || 'La Dolce');
  const [shopSlogan, setShopSlogan] = useState(appConfig?.shopSlogan || 'workspace intelligence');
  const [masterPin, setMasterPin] = useState(appConfig?.masterApprovalPin || '');
  const [saveLoading, setSaveLoading] = useState(false);
  const [admins, setAdmins] = useState<any[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'admin' | 'super_admin'>('admin');
  const [newAdminUid, setNewAdminUid] = useState('');

  // CSV/Excel Import & Migration State
  const [importLoading, setImportLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [supplierImportPriceMode, setSupplierImportPriceMode] = useState<'per_pack' | 'total'>('per_pack');

  // Reset Financial Transactions State
  const [resetPin, setResetPin] = useState('');
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const findHeaderIdx = (headers: string[], variations: string[]) => {
    return headers.findIndex(h => variations.some(v => h.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(h.toLowerCase())));
  };

  const parseExcelDate = (val: any) => {
    if (!val) return format(new Date(), 'yyyy-MM-dd');
    if (typeof val === 'number') {
      const d = new Date((val - 25569) * 86400 * 1000);
      return format(d, 'yyyy-MM-dd');
    }
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parts = str.split(/[\/\-.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      } else {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    return format(new Date(), 'yyyy-MM-dd');
  };

  const parseExcelTime = (val: any) => {
    if (!val) return '12:00';
    if (typeof val === 'number') {
      const totalSecs = Math.round(val * 86400);
      const hrs = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
    const str = String(val).trim();
    if (/^\d{2}:\d{2}$/.test(str)) return str;
    if (/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(str)) {
      const parts = str.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return '12:00';
  };

  const recalculateSummaryForDate = async (dateStr: string) => {
    try {
      const q = query(collection(db, 'transactions'), where('date', '==', dateStr));
      const txSnap = await getDocs(q);
      const txs = txSnap.docs.map(doc => doc.data());

      const prevQ = query(
        collection(db, 'dailySummaries'),
        where('date', '<', dateStr),
        orderBy('date', 'desc'),
        limit(1)
      );
      const prevSnap = await getDocs(prevQ);
      const previousBalance = !prevSnap.empty ? prevSnap.docs[0].data().finalBalance : 0;

      const summary = {
        date: dateStr,
        previousBalance: previousBalance,
        income: 0,
        expenses: 0,
        cashIncome: 0,
        cashExpenses: 0,
        onlineIncome: 0,
        onlineExpenses: 0,
        finalBalance: previousBalance,
        timestamp: serverTimestamp()
      };

      txs.forEach(tx => {
        const amount = Number(tx.amount) || 0;
        if (tx.type === 'income') {
          summary.income += amount;
          if (tx.source === 'cash') summary.cashIncome += amount;
          else summary.onlineIncome += amount;
        } else {
          summary.expenses += amount;
          if (tx.source === 'cash') summary.cashExpenses += amount;
          else summary.onlineExpenses += amount;
        }
      });

      summary.finalBalance = summary.previousBalance + summary.income - summary.expenses;
      await setDoc(doc(db, 'dailySummaries', dateStr), summary, { merge: true });

      const futureQ = query(
        collection(db, 'dailySummaries'),
        where('date', '>', dateStr),
        orderBy('date', 'asc')
      );
      const futureSnap = await getDocs(futureQ);
      
      let currentBalance = summary.finalBalance;
      for (const futureDoc of futureSnap.docs) {
        const data = futureDoc.data();
        const newFinal = currentBalance + (data.income || 0) - (data.expenses || 0);
        await setDoc(doc(db, 'dailySummaries', futureDoc.id), {
          previousBalance: currentBalance,
          finalBalance: newFinal,
          timestamp: serverTimestamp()
        }, { merge: true });
        currentBalance = newFinal;
      }
    } catch (err) {
      console.error("Error in recalculateSummaryForDate:", err);
    }
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>, type: 'transactions' | 'supplierPrices') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportStatus(i18n.language === 'la' ? "ກຳລັງອ່ານໄຟລ໌..." : "Reading file...");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (rawData.length < 2) {
          alert(i18n.language === 'la' ? "ໄຟລ໌ນີ້ບໍ່ມີຂໍ້ມູນພຽງພໍ" : "The file does not contain enough rows of data.");
          setImportLoading(false);
          setImportStatus(null);
          return;
        }

        const headers = rawData[0].map(h => String(h || '').trim().toLowerCase());
        const dataRows = rawData.slice(1).filter(row => row && row.length > 0 && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''));

        if (type === 'transactions') {
          const dateIdx = findHeaderIdx(headers, ['date', 'ວັນທີ', 'ວັນ', 'day', 'dt', 'transaction_date']);
          const timeIdx = findHeaderIdx(headers, ['time', 'ເວລາ', 'โมง']);
          const typeIdx = findHeaderIdx(headers, ['type', 'ປະເພດ', 'ລາຍຮັບ', 'ລາຍຈ່າຍ', 'income', 'expense']);
          const amountIdx = findHeaderIdx(headers, ['amount', 'ຈຳນວນເງິນ', 'ເງິນ', 'ລາຄາ', 'price', 'value', 'ເງິນທັງໝົດ']);
          const categoryIdx = findHeaderIdx(headers, ['category', 'ໝວດໝູ່', 'ໝວດ', 'cat']);
          const descIdx = findHeaderIdx(headers, ['description', 'ລາຍລະອຽດ', 'desc']);
          const sourceIdx = findHeaderIdx(headers, ['source', 'ແຫຼ່ງເງິນ', 'ແຫຼ່ງ', 'ເງິນສົດ', 'ໂອນ', 'cash', 'online', 'payment']);

          if (amountIdx === -1) {
            alert(i18n.language === 'la' 
              ? "ບໍ່ສາມາດຊອກຫາຖັນ 'Amount' ຫຼື 'ຈຳນວນເງິນ' ໄດ້. ກະລຸນາກວດສອບຫົວຂໍ້ຖັນ."
              : "Could not find 'Amount' or 'ຈຳນວນເງິນ' column in your sheet."
            );
            setImportLoading(false);
            setImportStatus(null);
            return;
          }

          setImportStatus(i18n.language === 'la' ? `ກຳລັງນຳເຂົ້າ ${dataRows.length} ລາຍການ...` : `Importing ${dataRows.length} records...`);

          const datesToRecalculate = new Set<string>();
          let successCount = 0;

          for (const row of dataRows) {
            const dateVal = dateIdx !== -1 ? parseExcelDate(row[dateIdx]) : format(new Date(), 'yyyy-MM-dd');
            const timeVal = timeIdx !== -1 ? parseExcelTime(row[timeIdx]) : format(new Date(), 'HH:mm');
            
            let rawType = 'expense';
            if (typeIdx !== -1) {
              const str = String(row[typeIdx] || '').toLowerCase().trim();
              if (str.includes('income') || str.includes('rece') || str.includes('ຮັບ') || str.includes('ລາຍຮັບ')) {
                rawType = 'income';
              }
            }

            let amt = 0;
            const rawAmt = row[amountIdx];
            if (typeof rawAmt === 'number') {
              amt = rawAmt;
            } else {
              amt = Number(String(rawAmt || '').replace(/[^0-9.]/g, '')) || 0;
            }

            let src = 'cash';
            if (sourceIdx !== -1) {
              const str = String(row[sourceIdx] || '').toLowerCase().trim();
              if (str.includes('online') || str.includes('bank') || str.includes('ໂອນ') || str.includes('qr') || str.includes('transfer')) {
                src = 'online';
              }
            }

            const category = categoryIdx !== -1 ? String(row[categoryIdx] || 'Other').trim() : 'Other';
            const description = descIdx !== -1 ? String(row[descIdx] || '').trim() : '';

            await addDoc(collection(db, 'transactions'), {
              type: rawType,
              amount: amt,
              category,
              description,
              source: src,
              date: dateVal,
              time: timeVal,
              createdAt: serverTimestamp(),
              userId: user.uid,
              userEmail: user.email || 'admin@example.com'
            });

            datesToRecalculate.add(dateVal);
            successCount++;
          }

          setImportStatus(i18n.language === 'la' 
            ? "ກຳລັງປັບປຸງຍອດເຫຼືອແຕ່ລະວັນ..." 
            : "Recalculating daily balances..."
          );
          
          const sortedDates = Array.from(datesToRecalculate).sort();
          for (const dStr of sortedDates) {
            await recalculateSummaryForDate(dStr);
          }

          setImportStatus(i18n.language === 'la' 
            ? `ສຳເລັດແລ້ວ! ນຳເຂົ້າທັງໝົດ ${successCount} ລາຍການ ແລະ ປັບປຸງ ${sortedDates.length} ວັນ.` 
            : `Success! Imported ${successCount} entries and updated summaries for ${sortedDates.length} days.`
          );

        } else if (type === 'supplierPrices') {
          const dateIdx = findHeaderIdx(headers, ['date', 'ວັນທີ', 'ວັນ', 'day', 'dt']);
          const supplierIdx = findHeaderIdx(headers, ['supplier', 'ຜູ້ສະໜອງ', 'ຮ້ານເປົ້າໝາຍ', 'ຮ້ານ', 'vendor']);
          const prodNameIdx = findHeaderIdx(headers, ['product', 'ຊື່ສິນຄ້າ', 'ສິນຄ້າ', 'item', 'ຊື່']);
          const priceIdx = findHeaderIdx(headers, ['price', 'ລາຄາ', 'ເງິນ', 'original', 'cost', 'amount']);
          const currencyIdx = findHeaderIdx(headers, ['currency', 'ສະກຸນເງິນ', 'ສະກຸນ']);
          const rateIdx = findHeaderIdx(headers, ['exchange', 'rate', 'ອັດຕາແລກປ່ຽນ', 'ອັດຕາ']);
          const qtyIdx = findHeaderIdx(headers, ['quantity', 'ຈຳນວນ', 'qty', 'count']);
          const qtyPerUnitIdx = findHeaderIdx(headers, ['per', 'pack', 'ຈຳນວນຕໍ່ໜ່ວຍ', 'capacity']);
          const unitIdx = findHeaderIdx(headers, ['unit', 'ຫົວໜ່ວຍ', 'ໜ່ວຍ']);
          const remarkIdx = findHeaderIdx(headers, ['remark', 'ໝາຍເຫດ', 'note', 'ເຫດ']);

          if (prodNameIdx === -1 || priceIdx === -1 || supplierIdx === -1) {
            alert(i18n.language === 'la'
              ? "ກະລຸນາກວດສອບວ່າໄຟລ໌ຂອງທ່ານມີຖັນ: 'ຊື່ສິນຄ້າ', 'ລາຄາ', 'ຜູ້ສະໜອງ'"
              : "Please verify your sheet contains at least: 'Product Name', 'Price', and 'Supplier' columns."
            );
            setImportLoading(false);
            setImportStatus(null);
            return;
          }

          setImportStatus(i18n.language === 'la' ? "ກຳລັງດຶງຂໍ້ມູນລາຍການສິນຄ້າ..." : "Loading products index...");

          const prodSnap = await getDocs(collection(db, 'products'));
          const productMap = new Map<string, string>();
          prodSnap.docs.forEach(d => {
            const name = d.data().name;
            if (name) productMap.set(name.trim().toLowerCase(), d.id);
          });

          setImportStatus(i18n.language === 'la' ? `ກຳລັງນຳເຂົ້າລາຄາຜູ້ສະໜອງ ${dataRows.length} ລາຍການ...` : `Importing ${dataRows.length} supplier price rows...`);
          let successCount = 0;

          for (const row of dataRows) {
            const productName = prodNameIdx !== -1 ? String(row[prodNameIdx] || '').trim() : '';
            if (!productName) continue;

            const dateVal = dateIdx !== -1 ? parseExcelDate(row[dateIdx]) : format(new Date(), 'yyyy-MM-dd');
            const supplier = String(row[supplierIdx] || 'General Supplier').trim();
            
            let priceOriginal = 0;
            const pVal = row[priceIdx];
            if (typeof pVal === 'number') {
              priceOriginal = pVal;
            } else {
              priceOriginal = Number(String(pVal || '').replace(/[^0-9.]/g, '')) || 0;
            }

            const currency = currencyIdx !== -1 ? String(row[currencyIdx] || 'LAK').toUpperCase().trim() : 'LAK';
            
            let exchangeRate = 1;
            if (rateIdx !== -1 && row[rateIdx] !== undefined) {
              exchangeRate = Number(row[rateIdx]) || 1;
            }

            const quantity = qtyIdx !== -1 ? Number(row[qtyIdx]) || 1 : 1;
            const quantityPerUnit = qtyPerUnitIdx !== -1 ? Number(row[qtyPerUnitIdx]) || 1 : 1;
            const unit = unitIdx !== -1 ? String(row[unitIdx] || 'UNIT').trim() : 'UNIT';
            const remark = remarkIdx !== -1 ? String(row[remarkIdx] || '').trim() : '';

            let productId = productMap.get(productName.toLowerCase());
            if (!productId) {
              const newProdRef = await addDoc(collection(db, 'products'), {
                name: productName,
                unit: unit,
                isApproved: true,
                createdAt: serverTimestamp()
              });
              productId = newProdRef.id;
              productMap.set(productName.toLowerCase(), productId);
            }

            let singlePriceOriginal = priceOriginal;
            if (supplierImportPriceMode === 'total') {
              singlePriceOriginal = priceOriginal / (quantity || 1);
            }

            const priceLAK = (currency === 'LAK' ? singlePriceOriginal : singlePriceOriginal * exchangeRate);
            const totalOriginal = supplierImportPriceMode === 'total' ? priceOriginal : priceOriginal * (quantity || 1);
            const totalLAK = (currency === 'LAK' ? totalOriginal : totalOriginal * exchangeRate);

            await addDoc(collection(db, 'supplierPrices'), {
              productId,
              supplier,
              priceOriginal: singlePriceOriginal, // Stored as Price per Single Pack
              exchangeRate,
              currency,
              quantity,
              quantityPerUnit,
              unit,
              remark,
              priceLAK, // Stored as LAK Price per Single Pack
              totalPriceOriginal: totalOriginal,  // Stored as total spent original currency
              totalPriceLAK: totalLAK,            // Stored as total spent in LAK
              priceMode: supplierImportPriceMode,
              date: dateVal,
              time: '12:00',
              createdAt: serverTimestamp(),
              userId: user.uid,
              userEmail: user.email || 'admin@example.com',
              branchId: selectedBranch || 'branch_1'
            });

            successCount++;
          }

          setImportStatus(i18n.language === 'la' 
            ? `ສຳເລັດແລ້ວ! ນຳເຂົ້າທັງໝົດ ${successCount} ລາຍການລາຄາຜູ້ສະໜອງ.` 
            : `Success! Imported ${successCount} supplier pricing records.`
          );
        }

      } catch (err: any) {
        console.error("Import calculation failed:", err);
        alert(i18n.language === 'la' ? "ເກີດຂໍ້ຜິດພາດໃນການປະມວນຜົນ: " + err.message : "Error processing worksheet: " + err.message);
        setImportStatus(null);
      } finally {
        setImportLoading(false);
        e.target.value = '';
      }
    };

    reader.readAsBinaryString(file);
  };

  // Sync state with props when they change
  useEffect(() => {
    if (!saveLoading) {
      setLogoUrl(appConfig?.logoUrl || userSettings?.logoUrl || '');
      setShopName(appConfig?.shopName || 'La Dolce');
      setShopSlogan(appConfig?.shopSlogan || 'workspace intelligence');
    }
  }, [userSettings?.logoUrl, appConfig?.logoUrl, appConfig?.shopName, appConfig?.shopSlogan]);

  useEffect(() => {
    if (appConfig?.masterApprovalPin !== undefined && !saveLoading) {
      setMasterPin(appConfig.masterApprovalPin || '');
    }
  }, [appConfig?.masterApprovalPin]);

  // ... previous effects

  const handleUpdateMasterPin = async () => {
    try {
      setSaveLoading(true);
      await setDoc(doc(db, 'settings', 'appConfig'), {
        masterApprovalPin: masterPin,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });
      alert("Master Approval PIN Updated");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'appConfig');
    } finally {
      setSaveLoading(false);
    }
  };

  // Fetch all admins for super admin management
  useEffect(() => {
    if (!isSuperAdmin) return;

    const q = query(collection(db, 'admins'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setAdmins(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => unsubscribe();
  }, [isSuperAdmin]);

  const handleAddAdmin = async () => {
    if (!newAdminUid || !newAdminEmail) {
      alert("Please enter User ID and Email");
      return;
    }
    try {
      setSaveLoading(true);
      await setDoc(doc(db, 'admins', newAdminUid), {
        email: newAdminEmail.toLowerCase(),
        role: newAdminRole,
        updatedAt: serverTimestamp()
      });
      setNewAdminEmail('');
      setNewAdminUid('');
      alert("Admin added successfully");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'admins');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRemoveAdmin = async (id: string) => {
    if (!confirm("Remove this administrator?")) return;
    try {
      await deleteDoc(doc(db, 'admins', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'admins');
    }
  };

  const handleUpdateShopInfo = async () => {
    try {
      setSaveLoading(true);
      await setDoc(doc(db, 'settings', 'appConfig'), {
        shopName: shopName,
        shopSlogan: shopSlogan,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });
      alert("Shop Information Updated");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'appConfig');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdateLogo = async (url?: string) => {
    const finalUrl = url || logoUrl;
    try {
      setSaveLoading(true);
      
      const batch: Promise<any>[] = [];
      
      // Update user specific settings
      batch.push(setDoc(doc(db, 'users', user.uid, 'settings', 'main'), {
        logoUrl: finalUrl,
        updatedAt: serverTimestamp()
      }, { merge: true }));

      // If super admin, update global config
      if (isSuperAdmin) {
        batch.push(setDoc(doc(db, 'settings', 'appConfig'), {
          logoUrl: finalUrl,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid
        }, { merge: true }));
      }

      await Promise.all(batch);
      setLogoUrl(finalUrl);
      alert("Logo Updated Successfully");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'settings');
    } finally {
      setSaveLoading(false);
    }
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Base64 overhead is ~33%. 500KB becomes ~665KB. 
    // Firestore doc limit is 1MB total.
    if (file.size > 500000) { 
      alert("ຮູບມີຂະໜາດໃຫຍ່ເກີນໄປ (ກະລຸນາໃຊ້ຮູບທີ່ນ້ອຍກວ່າ 500KB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        try {
          await handleUpdateLogo(base64);
        } catch (err) {
          console.error("Upload failed:", err);
          alert("ອັບໂຫຼດບໍ່ສຳເລັດ: ອາດຈະເປັນຍ້ອນຂະໜາດຮູບ ຫຼື ບັນຫາການເຊື່ອມຕໍ່");
        }
      }
    };
    reader.onerror = () => alert("ບໍ່ສາມາດອ່ານໄຟລ໌ຮູບໄດ້");
    reader.readAsDataURL(file);
  };

  const handleUpdatePin = async () => {
    if (userSettings?.financialPin && oldPinConfirm !== userSettings.financialPin) {
      alert("Invalid old PIN");
      return;
    }
    if (newPin.length < 4) {
      alert("PIN must be at least 4 digits");
      return;
    }

    try {
      setSaveLoading(true);
      await setDoc(doc(db, 'users', user.uid, 'settings', 'main'), {
        financialPin: newPin,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setNewPin('');
      setOldPinConfirm('');
      setIsChangingPin(false);
      alert("PIN Updated Successfully");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'userSettings');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdateSheets = async () => {
    try {
      setSaveLoading(true);
      await setDoc(doc(db, 'users', user.uid, 'settings', 'main'), {
        googleSheetsId: sheetsId,
        updatedAt: serverTimestamp()
      }, { merge: true });
      alert("Integration Updated");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'userSettings');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleResetFinancials = async () => {
    setResetError(null);
    setResetSuccess(null);

    // 1. PIN verification if it's set
    if (userSettings?.financialPin && resetPin !== userSettings.financialPin) {
      setResetError(i18n.language === 'la' ? 'PIN ບໍ່ຖືກຕ້ອງ!' : 'Invalid PIN!');
      return;
    }

    // 2. Extra double confirmation text check
    const normalizedText = resetConfirmationText.trim().toUpperCase();
    if (normalizedText !== 'CONFIRM' && normalizedText !== 'ຣີເຊັດ') {
      setResetError(i18n.language === 'la' ? 'ກະລຸນາພິມ "CONFIRM" ຫຼື "ຣີເຊັດ" ເພື່ອຢືນຢັນ' : 'Please type "CONFIRM" or "ຣີເຊັດ" to confirm.');
      return;
    }

    try {
      setSaveLoading(true);

      // Fetch all transactions
      const txSnap = await getDocs(collection(db, 'transactions'));
      const deleteTxPromises = txSnap.docs.map(docRef => deleteDoc(doc(db, 'transactions', docRef.id)));
      await Promise.all(deleteTxPromises);

      // Fetch all dailySummaries
      const summarySnap = await getDocs(collection(db, 'dailySummaries'));
      const deleteSummaryPromises = summarySnap.docs.map(docRef => deleteDoc(doc(db, 'dailySummaries', docRef.id)));
      await Promise.all(deleteSummaryPromises);

      setResetSuccess(t('reset_success'));
      setResetPin('');
      setResetConfirmationText('');
      
      // Auto-close overlay after 2 seconds
      setTimeout(() => {
        setIsConfirmingReset(false);
        setResetSuccess(null);
      }, 2000);
    } catch (e: any) {
      console.error("Reset error:", e);
      setResetError(i18n.language === 'la' ? 'ເກີດຂໍ້ຜິດພາດໃນການລຶບຂໍ້ມູນ!' : 'Error occurred while resetting data!');
    } finally {
      setSaveLoading(false);
    }
  };
  return (
    <div className="max-w-6xl mx-auto space-y-12 pb-20">
      {/* Profile & Logo Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Section */}
        <div className="lg:col-span-2 glass-card p-10 flex flex-col md:flex-row items-center gap-10 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-64 h-64 bg-primary/5 rounded-full -ml-32 -mt-32 transition-transform group-hover:scale-150 duration-1000"></div>
          <img src={user.photoURL} alt="Profile" className="w-32 h-32 rounded-[2.5rem] border-8 border-white dark:border-primary shadow-2xl relative z-10" />
          <div className="relative z-10 text-center md:text-left">
            <h3 className="text-4xl font-serif dark:text-white uppercase tracking-wider">{user.displayName}</h3>
            <p className="text-primary/40 dark:text-white/40 font-bold uppercase tracking-widest text-[10px] mt-2 mb-2">{user.email}</p>
            
            <div className="mb-6 p-3 bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-100 dark:border-white/5 inline-block">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Your Unique ID (Copy this for Admin setup)</p>
              <code className="text-[10px] font-mono text-primary dark:text-blue-400 select-all cursor-pointer" title="Click to select all">
                {user.uid}
              </code>
            </div>

            <div className={`flex items-center gap-3 px-6 py-2.5 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg ${user.emailVerified ? 'bg-green-500 text-white shadow-green-500/20' : 'bg-amber-500 text-white shadow-amber-500/20'}`}>
              <ShieldCheck className="w-4 h-4" />
              {user.emailVerified ? 'Verified Admin' : 'Unverified User'}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center items-center p-10 bg-[#052659] rounded-[2.5rem] shadow-2xl relative overflow-hidden group border-none">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
            <div className="relative z-10 py-6">
                <TextLogoPreview dark={true} name={shopName} />
            </div>
            <div className="w-12 h-[2px] bg-white/10 mt-6 relative z-10"></div>
            <p className="text-[8px] text-white/30 uppercase font-sans tracking-[0.2em] font-black mt-4 relative z-10 italic">Premium Workspace Identity</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        {/* Appearance */}
        <div className="glass-card p-10 space-y-10">
          <div className="flex items-center justify-between border-b dark:border-white/10 pb-6">
            <h4 className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest dark:text-white">
              <Sun className="w-5 h-5 text-amber-500" />
              Environment
            </h4>
          </div>
          
            <div className="space-y-6">
              <div>
                 <span className="block font-bold text-xs uppercase tracking-widest dark:text-white mb-2">Shop Branding</span>
                 <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Customize your workspace identity</p>
              </div>

              {isSuperAdmin && (
                <div className="space-y-4 p-6 bg-slate-50 dark:bg-white/5 rounded-3xl border border-slate-100 dark:border-white/10 mb-4 animate-in fade-in duration-500">
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Branding Name</label>
                      <input 
                        type="text" 
                        className="crystal-input !text-[11px] !h-12"
                        value={shopName}
                        onChange={e => setShopName(e.target.value)}
                        placeholder="e.g. La Dolce"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={handleUpdateShopInfo}
                    disabled={saveLoading}
                    className="w-full h-12 bg-slate-800 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg"
                  >
                    UPDATE BRANDING
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-6">
            <div>
               <span className="block font-black text-xs uppercase tracking-widest dark:text-white">{t('night_mode')}</span>
               <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 uppercase font-bold">Adjust workspace luminosity</p>
            </div>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`w-16 h-10 rounded-full p-1.5 transition-all duration-500 ${isDarkMode ? 'bg-[#052659]' : 'bg-slate-200'}`}
            >
              <div className={`w-7 h-7 rounded-full bg-white shadow-xl transform transition-transform duration-500 ease-out ${isDarkMode ? 'translate-x-6' : ''} flex items-center justify-center`}>
                {isDarkMode ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-amber-500" />}
              </div>
            </button>
          </div>

          <div className="space-y-6">
            <div>
               <span className="block font-bold text-xs uppercase tracking-widest dark:text-white mb-2">{t('lao')} / {t('english')}</span>
               <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Select primary interface dialect</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => i18n.changeLanguage('la')}
                className={`py-5 rounded-2xl border-2 font-bold uppercase tracking-widest text-[11px] transition-all duration-500 ${i18n.language === 'la' ? 'border-primary bg-primary text-white shadow-xl shadow-primary/20 scale-[1.02]' : 'border-slate-100 dark:border-white/5 dark:text-white opacity-40 hover:opacity-100'}`}
              >
                {t('lao')}
              </button>
              <button 
                onClick={() => i18n.changeLanguage('en')}
                className={`py-5 rounded-2xl border-2 font-bold uppercase tracking-widest text-[11px] transition-all duration-500 ${i18n.language === 'en' ? 'border-primary bg-primary text-white shadow-xl shadow-primary/20 scale-[1.02]' : 'border-slate-100 dark:border-white/5 dark:text-white opacity-40 hover:opacity-100'}`}
              >
                {t('english')}
              </button>
            </div>
          </div>
        </div>

        {/* Security & Access */}
        <div className="glass-card p-10 space-y-10">
          <div className="flex items-center justify-between border-b dark:border-white/10 pb-6">
            <h4 className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest dark:text-white">
              <Lock className="w-5 h-5 text-red-500" />
              Security Protocol
            </h4>
          </div>
          
          <div className="space-y-6">
            <div>
               <span className="block font-bold text-xs uppercase tracking-widest dark:text-white mb-2">Financial PIN</span>
               <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Secure sensitive financial data access</p>
            </div>
            
            {!userSettings?.financialPin || isChangingPin ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                {userSettings?.financialPin && (
                  <input 
                    type="password" 
                    placeholder="CONFIRM OLD PIN"
                    className="crystal-input !text-sm !h-12 text-center tracking-[0.3em]"
                    value={oldPinConfirm}
                    onChange={e => setOldPinConfirm(e.target.value.replace(/\D/g, ''))}
                  />
                )}
                <input 
                  type="password" 
                  placeholder="ENTER NEW PIN (4-6 DIGITS)"
                  className="crystal-input !text-sm !h-12 text-center tracking-[0.3em]"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                />
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={handleUpdatePin}
                    disabled={saveLoading}
                    className="py-4 bg-primary text-white rounded-2xl font-bold uppercase tracking-widest text-[11px]"
                  >
                    {saveLoading ? 'UPDATING...' : 'SAVE PIN'}
                  </button>
                  {userSettings?.financialPin && (
                    <button 
                      onClick={() => setIsChangingPin(false)}
                      className="py-4 bg-slate-100 dark:bg-white/5 dark:text-white rounded-2xl font-bold uppercase tracking-widest text-[11px]"
                    >
                      CANCEL
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-3xl flex justify-between items-center group">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-green-500/10 rounded-2xl">
                       <Key className="w-6 h-6 text-green-500" />
                    </div>
                    <div>
                       <p className="text-sm font-bold dark:text-white uppercase tracking-tight">Active Protection</p>
                       <p className="text-[10px] text-slate-400 uppercase font-bold mt-1">Terminal requires verification</p>
                    </div>
                 </div>
                 <button 
                  onClick={() => setIsChangingPin(true)}
                  className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest"
                 >
                   Update
                 </button>
              </div>
            )}
          </div>
        </div>

        {/* Integrations */}
        <div className="glass-card p-10 space-y-10">
          <div className="flex items-center justify-between border-b dark:border-white/10 pb-6">
            <h4 className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest dark:text-white">
              <Layout className="w-5 h-5 text-blue-500" />
              Main Integration
            </h4>
          </div>
          
          <div className="space-y-6">
            <div>
               <span className="block font-bold text-xs uppercase tracking-widest dark:text-white mb-2">Google Sheets ID</span>
               <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold">Connect your stock tracking sheet</p>
            </div>
            
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="SHEET ID (FROM URL)"
                className="crystal-input !text-[11px] !h-12 tracking-wide"
                value={sheetsId}
                onChange={e => setSheetsId(e.target.value)}
              />
              <button 
                onClick={handleUpdateSheets}
                disabled={saveLoading}
                className="w-full py-4 bg-[#052659] text-white rounded-2xl font-bold uppercase tracking-widest text-[11px]"
              >
                {saveLoading ? 'SAVING...' : 'SYNC REPOSITORY'}
              </button>
            </div>

            <div className="p-5 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/20">
               <p className="text-[10px] text-[#052659] dark:text-blue-300 italic leading-relaxed">
                 Integration allows the Dashboard to pull stock movement, burn rates, and predictive analytics directly from your Google Sheets data.
               </p>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="glass-card p-10 space-y-10 border border-red-500/20 bg-red-50/5 dark:bg-red-950/5">
          <div className="flex items-center justify-between border-b border-red-500/20 pb-6">
            <h4 className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-red-500">
               <Trash2 className="w-5 h-5 text-red-500" />
               {t('reset_financials_title')}
            </h4>
            <span className="px-2.5 py-0.5 text-[8px] font-black uppercase text-red-500 bg-red-500/10 rounded-full">
              {i18n.language === 'la' ? 'ອັນຕະລາຍ' : 'Danger Zone'}
            </span>
          </div>

          <div className="space-y-6">
            <div>
               <span className="block font-bold text-xs uppercase tracking-widest text-red-500 mb-2">
                 {t('reset_btn')}
               </span>
               <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold leading-normal">
                 {t('reset_financials_desc')}
               </p>
            </div>

            {isConfirmingReset ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                {resetError && (
                  <div className="p-4 bg-red-500/10 border border-red-500/30 text-red-500 rounded-2xl text-[10px] font-bold uppercase tracking-wider text-center">
                    {resetError}
                  </div>
                )}
                {resetSuccess && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-2xl text-[10px] font-bold uppercase tracking-wider text-center">
                    {resetSuccess}
                  </div>
                )}

                {userSettings?.financialPin && (
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase mb-2 block">
                      {i18n.language === 'la' ? 'ໃສ່ລະຫັດ PIN ການເງິນເພື່ອຢືນຢັນ' : 'ENTER FINANCIAL PIN TO CONFIRM'}
                    </label>
                    <input 
                      type="password" 
                      placeholder="XXXX"
                      maxLength={6}
                      className="crystal-input !text-sm !h-12 text-center tracking-[0.3em] border-red-300 focus:border-red-500 font-bold"
                      value={resetPin}
                      onChange={e => setResetPin(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                )}

                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase mb-2 block">
                    {i18n.language === 'la' ? 'ພິມ "CONFIRM" ຫຼື "ຣີເຊັດ" ເພື່ອຢືນຢັນ' : 'TYPE "CONFIRM" OR "ຣີເຊັດ" TO AUTHORIZE'}
                  </label>
                  <input 
                    type="text" 
                    placeholder={i18n.language === 'la' ? 'ພິມ ຣີເຊັດ' : 'TYPE CONFIRM'}
                    className="crystal-input !text-sm !h-12 text-center uppercase tracking-wider border-red-300 focus:border-red-500 font-bold"
                    value={resetConfirmationText}
                    onChange={e => setResetConfirmationText(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={handleResetFinancials}
                    disabled={saveLoading || (!resetConfirmationText.trim())}
                    className="py-4 bg-red-600 hover:bg-red-700 disabled:bg-red-600/20 disabled:text-red-500/40 text-white rounded-2xl font-bold uppercase tracking-widest text-[11px] transition-all cursor-pointer disabled:cursor-not-allowed"
                  >
                    {saveLoading ? (i18n.language === 'la' ? 'ກຳລັງລຶບ...' : 'RESETTING...') : (i18n.language === 'la' ? 'ຢືນຢັນການລຶບ' : 'CONFIRM RESET')}
                  </button>
                  <button 
                    onClick={() => {
                      setIsConfirmingReset(false);
                      setResetPin('');
                      setResetConfirmationText('');
                      setResetError(null);
                      setResetSuccess(null);
                    }}
                    disabled={saveLoading}
                    className="py-4 bg-slate-100 dark:bg-white/5 dark:text-white rounded-2xl font-bold uppercase tracking-widest text-[11px]"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setIsConfirmingReset(true);
                  setResetPin('');
                  setResetConfirmationText('');
                  setResetError(null);
                  setResetSuccess(null);
                }}
                className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded-2xl font-bold uppercase tracking-widest text-[11px] transition-all"
              >
                {t('reset_btn')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Data Import & Migration Section */}
      <div className="glass-card p-10 space-y-10 border border-slate-100 dark:border-white/10 dark:bg-white/5 shadow-2xl rounded-[2.5rem]">
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b dark:border-white/10 pb-6 gap-4">
          <div>
            <h4 className="flex items-center gap-3 text-sm font-black uppercase tracking-widest dark:text-white">
              <Database className="w-5 h-5 text-emerald-500" />
              {i18n.language === 'la' ? 'ລະບົບນຳເຂົ້າຂໍ້ມູນດ້ວຍ CSV, EXCEL' : 'CSV / EXCEL DATA IMPORT'}
            </h4>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-wider mt-1">
              {i18n.language === 'la' 
                ? 'ກູ້ຄືນ ຫຼື ນຳເຂົ້າຂໍ້ມູນເກົ່າທັງໝົດຂອງທ່ານຈາກໄຟລ໌ CSV ຫຼື Excel (ຮອງຮັບທັງພາສາລາວ ແລະ ອັງກິດ)' 
                : 'Restore or migrate your historical workspaces data straight from CSV/Excel sheets easily.'}
            </p>
          </div>
          {importStatus && (
            <div className="px-4 py-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center gap-2 border border-emerald-500/10 text-[10px] font-bold uppercase tracking-wider animate-pulse">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
              {importStatus}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Card 1: Transactions */}
          <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-3xl border border-slate-100 dark:border-white/10 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <span className="block font-black text-xs uppercase tracking-widest dark:text-white">
                {i18n.language === 'la' ? '໑. ນຳເຂົ້າ ລາຍການການເງິນ (Transactions)' : '1. Import Financial Transactions'}
              </span>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                {i18n.language === 'la' 
                  ? 'ຮອງຮັບຫົວຂໍ້ຖັນ: ວັນທີ (Date), ປະເພດ (Type: income/expense), ຈຳນວນເງິນ (Amount), ໝວດໝູ່ (Category), ລາຍລະອຽດ (Description), ແຫຼ່ງເງິນ (Source: cash/online), ເວລາ (Time).'
                  : 'Supports headers: Date, Type (income/expense), Amount, Category, Description, Source (cash/online), Time.'}
              </p>
              <div className="p-3 bg-white dark:bg-black/20 rounded-xl space-y-1 font-mono text-[9px] text-slate-500 max-h-[100px] overflow-y-auto">
                <span className="font-bold underline text-primary">{i18n.language === 'la' ? 'ຕົວຢ່າງຫົວຖັນ (ສາມາດເລືອກໃຊ້ໄດ້):' : 'Supported header synonyms:'}</span>
                <p>• ວັນທີ / Date: 2026-05-21, 21/05/2026</p>
                <p>• ຈຳນວນເງິນ / Amount: 50,000</p>
                <p>• ປະເພດ / Type: ລາຍຮັບ(income) / ລາຍຈ່າຍ(expense)</p>
                <p>• ແຫຼ່ງເງິນ / Source: ເງິນສົດ(cash) / ໂອນ(online)</p>
              </div>
            </div>

            <label className={`flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl py-8 px-4 cursor-pointer hover:border-emerald-500 dark:hover:border-emerald-400 transition-colors group ${importLoading ? 'opacity-30 pointer-events-none' : ''}`}>
              <Upload className="w-8 h-8 text-slate-400 group-hover:text-emerald-500 transition-colors mb-2" />
              <span className="text-[11px] font-bold text-slate-700 dark:text-white mb-1 uppercase text-center">
                {i18n.language === 'la' ? 'ເລືອກໄຟລ໌ ລາຍຮັບ-ລາຍຈ່າຍ (.xlsx, .csv)' : 'SELECT TRANSACTIONS FILE'}
              </span>
              <span className="text-[8px] text-slate-400 font-bold uppercase">.CSV, .XLSX, .XLS</span>
              <input 
                type="file" 
                accept=".csv, .xlsx, .xls" 
                className="hidden" 
                disabled={importLoading}
                onChange={e => handleImportFile(e, 'transactions')} 
              />
            </label>
          </div>

          {/* Card 2: Supplier Prices */}
          <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-3xl border border-slate-100 dark:border-white/10 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <span className="block font-black text-xs uppercase tracking-widest dark:text-white">
                {i18n.language === 'la' ? '໒. ນຳເຂົ້າ ລາຄາຜູ້ສະໜອງ (Supplier Pricing)' : '2. Import Supplier Pricing Grid'}
              </span>

              {/* Import Price Mode Option Selector */}
              <div className="space-y-1.5 p-3 rounded-2xl bg-[#052659]/5 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
                <label className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-300 block mb-1">
                  {i18n.language === 'la' ? 'ຮູບແບບລາຄາໃນໄຟລ໌ Excel / CSV' : 'Pricing Mode in Excel / CSV'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSupplierImportPriceMode('per_pack')}
                    className={`py-1.5 px-2 rounded-xl text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      supplierImportPriceMode === 'per_pack'
                        ? 'bg-[#052659] text-white shadow-md'
                        : 'bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{i18n.language === 'la' ? 'ລາຄາຕໍ່ແພັກ/ຖົງ' : 'Unit Price / Pack'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupplierImportPriceMode('total')}
                    className={`py-1.5 px-2 rounded-xl text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      supplierImportPriceMode === 'total'
                        ? 'bg-[#052659] text-white shadow-md'
                        : 'bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{i18n.language === 'la' ? 'ລາຄາລວມທັງໝົດ' : 'Total Batch Spent'}</span>
                  </button>
                </div>
                <p className="text-[8px] text-slate-400 italic font-medium leading-tight pt-1">
                  {supplierImportPriceMode === 'total' 
                    ? (i18n.language === 'la' ? 'ລະບົບຈະສະແດງລາຄາຕໍ່ຖົງໂດຍຫານໃຫ້ "ຈຳນວນ" ໃນໄຟລ໌' : 'Calculates the single unit cost by dividing the imported Price by Quantity')
                    : (i18n.language === 'la' ? 'ລາຄາໃນໄຟລ໌ແມ່ນລາຄາຕໍ່ຖົງດຽວແລ້ວ' : 'Treats the imported Price as the ready-to-use Unit Price per pack')
                  }
                </p>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                {i18n.language === 'la' 
                  ? 'ຮອງຮັບຫົວຂໍ້ຖັນ: ຜູ້ສະໜອງ (Supplier), ຊື່ສິນຄ້າ (Product Name), ລາຄາ (Price), ສະກຸນເງິນ (Currency: LAK/THB/USD), ຫົວໜ່ວຍ (Unit), ຈຳນວນ (Quantity), ໝາຍເຫດ (Remark).'
                  : 'Supports headers: Supplier, Product Name, Price, Currency (LAK/THB), Unit, Quantity, Remark.'}
              </p>
              <div className="p-3 bg-white dark:bg-black/20 rounded-xl space-y-1 font-mono text-[9px] text-slate-500 max-h-[100px] overflow-y-auto">
                <span className="font-bold underline text-primary">{i18n.language === 'la' ? 'ຕົວຢ່າງຫົວຖັນ (ສ້າງສິນຄ້າໃຫມ່ອັດຕະໂນມັດ):' : 'Supported header synonyms (auto creating products):'}</span>
                <p>• ຜູ້ສະໜອງ / Supplier: ຮ້ານກາເຟ, Supplier A</p>
                <p>• ຊື່ສິນຄ້າ / Product Name: ເມັດກາເຟ, Coffee Beans</p>
                <p>• ລາຄາ / Price (Original): 250,000</p>
                <p>• ຫົວໜ່ວຍ / Unit: KG, PACK, BOX</p>
              </div>
            </div>

            <label className={`flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl py-8 px-4 cursor-pointer hover:border-emerald-500 dark:hover:border-emerald-400 transition-colors group ${importLoading ? 'opacity-30 pointer-events-none' : ''}`}>
              <Upload className="w-8 h-8 text-slate-400 group-hover:text-emerald-500 transition-colors mb-2" />
              <span className="text-[11px] font-bold text-slate-700 dark:text-white mb-1 uppercase text-center">
                {i18n.language === 'la' ? 'ເລືອກໄຟລ໌ ລາຄາຜູ້ສະໜອງ (.xlsx, .csv)' : 'SELECT SUPPLIER PRICING FILE'}
              </span>
              <span className="text-[8px] text-slate-400 font-bold uppercase">.CSV, .XLSX, .XLS</span>
              <input 
                type="file" 
                accept=".csv, .xlsx, .xls" 
                className="hidden" 
                disabled={importLoading}
                onChange={e => handleImportFile(e, 'supplierPrices')} 
              />
            </label>
          </div>
        </div>

        <div className="p-5 bg-[#052659]/5 dark:bg-white/5 rounded-2xl border border-[#052659]/10">
          <p className="text-[10px] text-slate-500 leading-relaxed italic">
            {i18n.language === 'la' 
              ? '💡 ຄຳແນະນຳ: ທ່ານສາມາດດາວໂຫຼດ ຫຼື ສົ່ງອອກຂໍ້ມູນຂອງທ່ານເປັນ CSV ຈາກ Google Sheets ຫຼື ລະບົບອື່ນໆ ໂດຍກວດສອບໃຫ້ແນ່ໃຈວ່າແຖວທຳອິດເປັນຊື່ຖັນ (ຫົວຂໍ້ຖັນ). ລະບົບຈະກວດຈັບຊື່ຖັນອັດຕະໂນມັດ ແລະ ນຳເຂົ້າຂໍ້ມູນຢ່າງລວດໄວໂດຍບໍ່ຕ້ອງປ້ອນດ້ວຍມື!'
              : '💡 Tip: Export data as CSV/XLS or from your sheets. Ensure row 1 holds English or Lao header column names. System automatically detects patterns & inserts everything instantly.'}
          </p>
        </div>
      </div>

      {/* Super Admin Panel */}
      {isSuperAdmin && (
        <div className="glass-card p-10 space-y-10 border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between border-b dark:border-white/10 pb-6">
            <h4 className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.2em] dark:text-white">
              <Users className="w-5 h-5 text-primary" />
              Super Admin Management
            </h4>
            <div className="px-3 py-1 bg-primary text-white text-[9px] font-black uppercase rounded-lg">Master Access</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Add Admin */}
            <div className="space-y-6">
              <div className="p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-white/5">
                <h5 className="text-xs font-black uppercase tracking-widest mb-4">Master Approval PIN</h5>
                <p className="text-[10px] text-slate-400 mb-4 font-bold uppercase tracking-widest">Global code for Super Admin overrides</p>
                <div className="space-y-4">
                  <input 
                    type="password" 
                    placeholder="ENTER MASTER PIN (4-6 DIGITS)"
                    className="crystal-input !h-12 !text-[11px] text-center tracking-[0.3em]"
                    value={masterPin}
                    onChange={e => setMasterPin(e.target.value.replace(/\D/g, ''))}
                  />
                  <button 
                    onClick={handleUpdateMasterPin}
                    disabled={saveLoading}
                    className="w-full h-12 bg-[#052659] text-white rounded-xl font-black uppercase tracking-widest text-[10px]"
                  >
                    UPDATE MASTER PIN
                  </button>
                </div>
              </div>

              <div className="p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-white/5">
                <h5 className="text-xs font-black uppercase tracking-widest mb-4">Add New Administrator</h5>
                <div className="space-y-4">
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">User UID</label>
                    <input 
                      type="text" 
                      placeholder="ENTER FIREBASE UID"
                      className="crystal-input !h-12 !text-[11px]"
                      value={newAdminUid}
                      onChange={e => setNewAdminUid(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Email Address</label>
                    <input 
                      type="email" 
                      placeholder="ADMIN@EXAMPLE.COM"
                      className="crystal-input !h-12 !text-[11px]"
                      value={newAdminEmail}
                      onChange={e => setNewAdminEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">Role Type</label>
                    <select 
                      className="crystal-input !h-12 !text-[11px] !py-0"
                      value={newAdminRole}
                      onChange={e => setNewAdminRole(e.target.value as any)}
                    >
                      <option value="admin">Regular Admin</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </div>
                  <button 
                    onClick={handleAddAdmin}
                    disabled={saveLoading}
                    className="w-full h-14 bg-primary text-white rounded-2xl font-black uppercase tracking-widest text-[11px] hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary/20"
                  >
                    {saveLoading ? 'PROCESSING...' : 'GRANT PERMISSIONS'}
                  </button>
                </div>
              </div>
            </div>

            {/* Admin List */}
            <div className="space-y-4">
               <h5 className="text-xs font-black uppercase tracking-widest px-2">Active Administrators</h5>
               <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                 {admins.map(adm => (
                   <div key={adm.id} className="p-4 bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-white/5 flex items-center justify-between group">
                     <div>
                       <p className="text-xs font-bold dark:text-white">{adm.email}</p>
                       <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${adm.role === 'super_admin' ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-400'}`}>
                            {adm.role.replace('_', ' ')}
                          </span>
                          <span className="text-[8px] text-slate-400 font-mono">{adm.id}</span>
                       </div>
                     </div>
                     <button 
                       onClick={() => handleRemoveAdmin(adm.id)}
                       className="p-3 text-red-500 hover:bg-red-500/10 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
                     >
                       <Trash2 className="w-4 h-4" />
                     </button>
                   </div>
                 ))}
                 {admins.length === 0 && (
                   <div className="p-10 text-center text-slate-400 text-[10px] font-black uppercase italic tracking-widest bg-slate-50 dark:bg-white/5 rounded-3xl">
                     No secondary admins assigned
                   </div>
                 )}
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
