/**
 * WebContainer 单例管理
 *
 * WebContainer.boot() 是重量级操作（启动浏览器内"操作系统"），必须全局只调用一次。
 * 通过模块级 Promise 缓存确保：
 * - 页面首次挂载 WorkbenchContent 时触发一次 boot
 * - 用户导航离开再回来时，直接复用已 boot 的实例，无需重新安装依赖
 *
 * 注意：teardown() 会销毁实例，不要在组件 cleanup 中调用它。
 */

import { WebContainer } from "@webcontainer/api";

let bootPromise: Promise<WebContainer> | null = null;

/**
 * 获取（或启动）全局 WebContainer 单例。
 * 多次调用返回同一个 Promise，boot 只会发生一次。
 */
export function getWebContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot().catch((err) => {
      // boot 失败时重置，允许下次重试
      bootPromise = null;
      throw err;
    });
  }
  return bootPromise;
}
