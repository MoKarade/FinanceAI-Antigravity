import React, { useEffect, useRef, useState } from 'react';
import {
  motion,
  useReducedMotion,
  useScroll,
} from 'framer-motion';
import type { SemanticTone } from '../../services/valoria/dailyTechnicalIndicators';
import { useFinanceStore } from '../../store/useFinanceStore';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Top 2px viewport scroll progress bar using GPU-only scaleX transform.
 */
export const ScrollProgressBar: React.FC = () => {
  const prefersReduced = useReducedMotion();
  const { scrollYProgress } = useScroll();

  if (prefersReduced) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-surface/70 pointer-events-none"
    >
      <motion.div
        style={{ scaleX: scrollYProgress }}
        className="h-full w-full origin-left bg-linear-to-r from-texte-doux via-texte to-succes-texte"
      />
    </div>
  );
};

/**
 * Scroll-triggered section entrance using compositor-only transform & opacity.
 * Re-triggers subtly when scrolling back and forth across long visual views.
 */
export const ScrollReveal: React.FC<{
  children: React.ReactNode;
  className?: string;
  delay?: number;
  yOffset?: number;
  once?: boolean;
}> = ({ children, className = '', delay = 0, yOffset = 22, once = true }) => {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: yOffset, scale: 0.988 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once, amount: 0.08, margin: '0px 0px -24px 0px' }}
      transition={{
        duration: 0.48,
        delay,
        ease: EASE_OUT_EXPO,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * Cascading grid container that staggers child cards as the user scrolls.
 */
export const StaggerGrid: React.FC<{
  children: React.ReactNode;
  className?: string;
  staggerDelay?: number;
}> = ({ children, className = '' }) => {
  return <div className={className}>{children}</div>;
};

export const StaggerCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  index?: number;
}> = ({ children, className = '', index = 0 }) => {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.34,
        delay: Math.min(0.28, (index % 9) * 0.032),
        ease: EASE_OUT_EXPO,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * Crisp <= 180ms interactive card wrapper with GPU lift and tap response.
 */
export const HoverLiftCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({ children, className = '', onClick }) => {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <div onClick={onClick} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      onClick={onClick}
      whileTap={onClick ? { scale: 0.988, transition: { duration: 0.1 } } : undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * Scroll-animated horizontal progress bar restricted strictly to sober neutral, green, or red.
 */
export const AnimatedMeterBar: React.FC<{
  pct: number;
  tone: SemanticTone;
  heightClass?: string;
  delay?: number;
  immediate?: boolean;
  privacySensitive?: boolean;
}> = ({ pct, tone, heightClass = 'h-2', delay = 0.05, immediate = false, privacySensitive = false }) => {
  const prefersReduced = useReducedMotion();
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const clamped = Math.max(3, Math.min(100, pct));
  const effectivePct = privacySensitive && isPrivacyMode ? 0 : clamped;

  const fillClass =
    tone === 'positive'
      ? 'bg-succes-texte'
      : tone === 'negative'
        ? 'bg-erreur-texte'
        : 'bg-texte';

  return (
    <div
      className={`w-full ${heightClass} rounded-full bg-surface-douce/90 overflow-hidden`}
    >
      {prefersReduced ? (
        <div
          className={`h-full rounded-full ${fillClass}`}
          style={{ width: isPrivacyMode && privacySensitive ? '0%' : `${clamped}%` }}
        />
      ) : immediate ? (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: effectivePct / 100 }}
          transition={{ duration: 0.5, delay, ease: EASE_OUT_EXPO }}
          className={`h-full w-full origin-left rounded-full ${fillClass}`}
        />
      ) : (
        <motion.div
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: clamped / 100 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.6, delay, ease: EASE_OUT_EXPO }}
          className={`h-full w-full origin-left rounded-full ${fillClass}`}
        />
      )}
    </div>
  );
};

/**
 * Smoothly interpolates displayed numbers when values change.
 */
export const AnimatedNumber: React.FC<{
  value: number;
  formatter: (n: number) => string;
  className?: string;
}> = ({ value, formatter, className = '' }) => {
  const prefersReduced = useReducedMotion();
  const [displayVal, setDisplayVal] = useState<number>(value);
  const prevRef = useRef<number>(value);

  useEffect(() => {
    if (prefersReduced) {
      setDisplayVal(value);
      prevRef.current = value;
      return;
    }

    const from = prevRef.current;
    const to = value;
    if (Math.abs(to - from) < 0.005) {
      setDisplayVal(to);
      prevRef.current = to;
      return;
    }

    const durationMs = 460;
    const startTs = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / durationMs);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      setDisplayVal(next);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        prevRef.current = to;
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, prefersReduced]);

  return <span className={`tabular-nums ${className}`}>{formatter(displayVal)}</span>;
};
