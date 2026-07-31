// 全站统一导航（PRD product-roadmap-prd.md §2 N1）。
// 叶子模块：只依赖 react / lucide-react，绝不 import App.tsx（见 canvas-v2-prd §5.2 的循环依赖约束）。
// 设计规则：
// - 顺序固定为 首页/工作台/画布/广场，与首页一致，任何接入页不得改序；
// - 当前页保留在导航里并给激活态（而不是"省略自己"——那套心智模型在 Studio 已经失效过）；
// - 激活态用文字加粗 + 指示条，不用品牌绿填充（60/30/10：导航不是品牌时刻）;
// - 颜色与背景都取 token，进 .canvas-page 这类暗色作用域时自动反转（.subtle-button 的教训）。
import type { ReactNode } from "react";
import { Compass, Frame, House, WandSparkles } from "lucide-react";

export type AppNavPage = "home" | "studio" | "canvas" | "square" | "admin";
export type AppNavTarget = "home" | "studio" | "canvas" | "square";

const NAV_ITEMS: Array<{ key: AppNavTarget; label: string; Icon: typeof House }> = [
  { key: "home", label: "首页", Icon: House },
  { key: "studio", label: "工作台", Icon: WandSparkles },
  { key: "canvas", label: "画布", Icon: Frame },
  { key: "square", label: "广场", Icon: Compass },
];

export function AppNav({
  current,
  onNavigate,
  brandLogo,
  badge,
  compact = false,
  runningCount = 0,
  end,
}: {
  current: AppNavPage;
  onNavigate: (page: AppNavTarget) => void;
  brandLogo: string;
  /** 页面徽标（如 "Canvas" / "Square"），显示在品牌右侧 */
  badge?: string;
  /** 紧凑模式（Studio 顶栏）：品牌只显示 logo，省出横向空间 */
  compact?: boolean;
  /** 进行中的生成任务数，>0 时挂在「工作台」项上 */
  runningCount?: number;
  /** 右侧自定义区（账号、登录等），由接入页自带 */
  end?: ReactNode;
}) {
  return (
    <div className={`app-nav ${compact ? "is-compact" : ""}`}>
      <button
        type="button"
        className="app-nav-brand"
        onClick={() => {
          if (current === "home") window.scrollTo({ top: 0, behavior: "smooth" });
          else onNavigate("home");
        }}
        aria-label="Image Studio 首页"
      >
        <img src={brandLogo} alt="" aria-hidden="true" />
        {!compact && <strong>Image Studio</strong>}
        {badge && <span className="app-nav-badge">{badge}</span>}
      </button>
      <nav className="app-nav-items" aria-label="主导航">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={current === key ? "is-active" : ""}
            aria-current={current === key ? "page" : undefined}
            onClick={() => {
              if (current === key) {
                if (key === "home") window.scrollTo({ top: 0, behavior: "smooth" });
                return;
              }
              onNavigate(key);
            }}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
            {key === "studio" && runningCount > 0 && (
              <span className="app-nav-count" title={`${runningCount} 个任务生成中`}>
                {runningCount}
              </span>
            )}
          </button>
        ))}
      </nav>
      {end && <div className="app-nav-end">{end}</div>}
    </div>
  );
}
