import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export const BottomSheet = ({ open, onClose, children }: BottomSheetProps) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.1}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100) onClose();
          }}
          className="fixed bottom-0 left-0 right-0 z-50 glass-card-elevated rounded-t-[28px] max-h-[85vh] overflow-y-auto"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex justify-center pt-3 pb-4">
            <div className="w-10 h-1 bg-white/20 rounded-full" />
          </div>
          <div className="px-6 pb-8">{children}</div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default BottomSheet;