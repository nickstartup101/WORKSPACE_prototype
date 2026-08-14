import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  correctPin?: string;
  onSuccess: (newPin?: string) => void;
  mode?: 'verify' | 'setup';
}

export default function PinModal({ isOpen, onClose, correctPin, onSuccess, mode = 'verify' }: PinModalProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState(1);
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'verify') {
      if (pin === correctPin) {
        onSuccess();
        setPin('');
        setError(false);
      } else {
        setError(true);
        setPin('');
        setTimeout(() => setError(false), 500);
      }
    } else {
      // Setup mode
      if (step === 1) {
        if (pin.length >= 4) {
          setStep(2);
          setError(false);
        } else {
          setError(true);
          setTimeout(() => setError(false), 500);
        }
      } else {
        if (pin === confirmPin) {
          onSuccess(pin);
          setPin('');
          setConfirmPin('');
          setStep(1);
          setError(false);
        } else {
          setError(true);
          setConfirmPin('');
          setTimeout(() => setError(false), 500);
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-primary/40 backdrop-blur-md animate-in fade-in duration-300">
      <div className={`glass-card max-w-sm w-full p-10 space-y-8 border-white/20 shadow-2xl transition-transform duration-300 ${error ? 'animate-shake' : ''}`}>
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
            <ShieldCheck className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-2xl font-serif text-primary dark:text-white uppercase tracking-wider leading-none">
            {mode === 'setup' ? (step === 1 ? 'Shield Deployment' : 'Seal the Protocol') : 'Security Required'}
          </h3>
          <p className="text-[10px] text-slate-400 mt-3 font-bold uppercase tracking-widest italic">
            {mode === 'setup' ? (step === 1 ? 'Establish Admin PIN' : 'Confirm Security Code') : 'Enter Administrative PIN'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-center gap-3">
             <input 
                type="password"
                maxLength={6}
                autoFocus
                className="w-full h-16 text-center text-4xl font-black tracking-[0.5em] bg-slate-50 dark:bg-white/5 border-2 border-slate-100 dark:border-white/10 rounded-2xl outline-none focus:border-primary transition-all dark:text-white"
                value={step === 1 ? pin : confirmPin}
                onChange={(e) => step === 1 ? setPin(e.target.value.replace(/\D/g, '')) : setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
             />
          </div>

          <div className="space-y-3">
            <button 
              type="submit"
              className="crystal-button w-full py-5 text-sm"
            >
              {mode === 'setup' ? (step === 1 ? 'Next Layer' : 'Initialize Terminal') : 'Unlock Terminal'}
            </button>
            <button 
              type="button"
              onClick={onClose}
              className="w-full text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors py-2"
            >
              Exit Access
            </button>
          </div>
        </form>

        {error && (
          <p className="text-center text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse">
            Access Denied • Invalid Code
          </p>
        )}
      </div>
    </div>
  );
}
