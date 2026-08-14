import React, { useState, useEffect } from 'react';
import { ShieldAlert, Lock, Smartphone, Check, X } from 'lucide-react';
import { auth, db } from '../firebase';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  onSnapshot, 
  doc, 
  deleteDoc 
} from 'firebase/firestore';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => void;
  actionType: string;
  actionData?: any;
  masterPin?: string;
}

export default function ApprovalModal({ isOpen, onClose, onApprove, actionType, actionData, masterPin }: ApprovalModalProps) {
  const [adminCode, setAdminCode] = useState('');
  const [isRemoteRequested, setIsRemoteRequested] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentRequestId) return;

    const unsubscribe = onSnapshot(doc(db, 'approval_requests', currentRequestId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.status === 'approved') {
          onApprove();
          // Cleanup
          deleteDoc(doc(db, 'approval_requests', currentRequestId));
          onClose();
        } else if (data.status === 'rejected') {
          setError('Request was rejected by admin');
          setIsRemoteRequested(false);
          setCurrentRequestId(null);
        }
      }
    });

    return () => unsubscribe();
  }, [currentRequestId]);

  if (!isOpen) return null;

  const handleAdminVerify = () => {
    // Check against global master PIN if set, otherwise fallback to legacy 2026
    const validPin = masterPin || '2026';
    if (adminCode === validPin) {
      onApprove();
      onClose();
      setAdminCode('');
    } else {
      setError('Invalid Admin Code');
    }
  };

  const requestRemoteApproval = async () => {
    setError(null);
    try {
      const docRef = await addDoc(collection(db, 'approval_requests'), {
        type: actionType,
        data: actionData || null,
        status: 'pending',
        requestedByUid: auth.currentUser?.uid,
        requestedByEmail: auth.currentUser?.email,
        createdAt: serverTimestamp()
      });
      setCurrentRequestId(docRef.id);
      setIsRemoteRequested(true);
    } catch (err: any) {
      console.error("Remote request error:", err);
      setError("Failed to send request. Check connection.");
    }
  };

  const handleCancelRemote = async () => {
    if (currentRequestId) {
      await deleteDoc(doc(db, 'approval_requests', currentRequestId));
    }
    setIsRemoteRequested(false);
    setCurrentRequestId(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#052659]/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="glass-card max-w-sm w-full bg-white dark:bg-slate-900 border-primary/20 shadow-2xl p-8 space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <ShieldAlert className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-black text-primary dark:text-white uppercase tracking-tight">Admin Approval</h3>
          <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-widest">Verification Required for {actionType.toUpperCase()}</p>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-500 text-[10px] font-bold rounded-xl flex items-center gap-2 animate-in slide-in-from-top-2">
              <ShieldAlert className="w-4 h-4" />
              {error}
            </div>
          )}

          {!isRemoteRequested ? (
            <>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 w-4 h-4 text-slate-300" />
                <input 
                  type="password"
                  placeholder="ENTER ADMIN PIN"
                  className="w-full h-12 pl-10 pr-4 text-center text-lg font-black tracking-[0.5em] rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 dark:text-white focus:border-primary outline-none"
                  value={adminCode}
                  onChange={e => {
                    setAdminCode(e.target.value);
                    if (error) setError(null);
                  }}
                  autoFocus
                />
              </div>
              <button 
                onClick={handleAdminVerify}
                className="w-full h-12 bg-[#052659] text-white rounded-xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg"
              >
                Confirm Action
              </button>
              <div className="relative flex items-center gap-4 py-2">
                <div className="flex-1 h-px bg-slate-100 dark:bg-white/5"></div>
                <span className="text-[10px] font-bold text-slate-300 uppercase">OR</span>
                <div className="flex-1 h-px bg-slate-100 dark:bg-white/5"></div>
              </div>
              <button 
                onClick={requestRemoteApproval}
                className="w-full h-12 border-2 border-primary/20 text-primary dark:text-white rounded-xl font-bold uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 hover:bg-primary/5 transition-all"
              >
                <Smartphone className="w-4 h-4" />
                Remote Approval Request
              </button>
            </>
          ) : (
            <div className="text-center py-8 animate-in zoom-in duration-300">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping"></div>
                <div className="relative w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center border-2 border-emerald-500/30">
                  <Smartphone className="w-10 h-10 text-emerald-500 animate-bounce" />
                </div>
              </div>
              <p className="text-lg font-black text-[#052659] dark:text-white uppercase tracking-tight">Request Active</p>
              <p className="text-[10px] text-slate-500 uppercase mt-2 font-bold tracking-widest leading-relaxed">
                Waiting for Super Admin to confirm<br/>via secure mobile link
              </p>
              
              <div className="mt-8 pt-6 border-t border-slate-100 dark:border-white/5">
                <button 
                  onClick={handleCancelRemote}
                  className="text-[10px] font-black text-primary hover:text-primary/70 underline uppercase tracking-[0.2em] transition-colors"
                >
                  Cancel & Use Direct PIN
                </button>
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={onClose}
          className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
