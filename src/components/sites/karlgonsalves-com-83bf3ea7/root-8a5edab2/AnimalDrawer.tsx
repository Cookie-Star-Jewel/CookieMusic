"use client";

import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "naive-icons";
import "./animal-ui.css";

export type DrawerPlacement = "top" | "right" | "bottom" | "left";

interface AnimalDrawerProps {
  open: boolean;
  title?: ReactNode;
  placement?: DrawerPlacement;
  /** left / right 抽屉的宽度（px） */
  width?: number;
  /** top / bottom 抽屉的高度（px） */
  height?: number;
  /** 点遮罩是否可关闭 */
  maskClosable?: boolean;
  /** 打开时是否把背景缩放+模糊（景深效果），默认关闭 */
  pushBackground?: boolean;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 透传到面板根元素的类名 */
  className?: string;
}

/**
 * animal-island-ui Drawer 的复刻：
 * - 四方向滑入面板（奶油米白底、20px 圆角、暖色阴影）；
 * - 遮罩 rgba(0,0,0,0.18)；
 * - pushBackground：对 body 的直接子元素（非 fixed）施加 scale(0.94)+blur(1px)
 *   的"推远"景深效果，transition 0.36s cubic-bezier(0.2,0,0,2,1)；
 * - 面板/遮罩常驻挂载（portal 到 body），用 class 切换过渡，开合都有动画。
 */
export default function AnimalDrawer({
  open,
  title,
  placement = "right",
  width = 378,
  height = 300,
  maskClosable = true,
  pushBackground = false,
  footer,
  onClose,
  children,
  className,
}: AnimalDrawerProps) {
// createPortal 只能在客户端跑（SSR 时 document 不存在）：
// hydration 完成前 mounted=false，之后恒为 true（lint 干净的等价写法）
const emptySubscribe = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 背景"推远"景深
  useEffect(() => {
    if (!open || !pushBackground) return;
    const pushed: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement)) continue;
      if (["SCRIPT", "STYLE", "LINK", "NOSCRIPT"].includes(el.tagName)) continue;
      if (el.hasAttribute("data-animal-drawer-ignore")) continue;
      const { position } = getComputedStyle(el);
      if (position === "fixed" || position === "absolute") continue;
      el.classList.add("animal-drawer-pushed");
      pushed.push(el);
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const el of pushed) el.classList.remove("animal-drawer-pushed");
      document.body.style.overflow = prevOverflow;
    };
  }, [open, pushBackground]);

  const mounted = useSyncExternalStore(emptySubscribe, clientMounted, serverMounted);
  if (!mounted) return null;

  const panelStyle: CSSProperties = {};
  if (placement === "left" || placement === "right") panelStyle.width = width;
  if (placement === "top" || placement === "bottom") panelStyle.height = height;

  return createPortal(
    <>
      <div
        className={`animal-drawer-mask${open ? " animal-drawer-mask-open" : ""}`}
        onClick={maskClosable ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        className={`animal-drawer-panel animal-drawer-${placement}${open ? " animal-drawer-open" : ""} animal-cursor--force${className ? ` ${className}` : ""}`}
        style={panelStyle}
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-label={typeof title === "string" ? title : "抽屉"}
      >
        <div className="animal-drawer-header">
          <div className="animal-drawer-title">{title}</div>
          <button type="button" className="animal-drawer-close" aria-label="关闭" onClick={onClose}>
            <CloseIcon size={15} color="currentColor" />
          </button>
        </div>
        <div className="animal-drawer-body">{children}</div>
        {footer ? <div className="animal-drawer-footer">{footer}</div> : null}
      </div>
    </>,
    document.body,
  );
}
