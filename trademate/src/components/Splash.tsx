import { motion } from "framer-motion";

export function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <motion.img
        src="/icon.svg"
        alt=""
        className="h-16 w-16 rounded-2xl"
        animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <p className="text-lg font-semibold text-white">
        Trade<span className="text-gold-400">Mate</span>
      </p>
    </div>
  );
}
