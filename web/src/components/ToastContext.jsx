import React, { createContext, useContext, useState } from 'react';

const ToastContext = createContext();

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState({ message: '', isError: false, visible: false });

  const showToast = (message, isError = false) => {
    setToast({ message, isError, visible: true });
    setTimeout(() => {
      setToast({ message: '', isError: false, visible: false });
    }, 3000);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast.visible && (
        <div className={`toast ${toast.isError ? 'error-toast' : ''}`}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);