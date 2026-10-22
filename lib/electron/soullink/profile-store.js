/**
 * Soullink profile 的生成与缓存（主进程侧）。
 *
 * 职责边界：
 *   - profile-generator 是 Node 包，只能在主进程跑（引擎在渲染进程是打包好的 IIFE）
 *   - 缓存写到 `~/.dsh/live2d-deskpet/profiles/<modelId>.json`，**不写安装目录**
 *     （插件可能装在 asar 里，安装目录只读）
 *   - 生成失败一律返回 null，调用方回 404，渲染进程据此保持 0.1.9 行为
 *
 * 为什么缓存不直接读 SDK 写在模型目录里那份：模型目录属于用户资产，插件不该
 * 依赖它的可写性；缓存放 dataDir 才能保证「模型只读也能用」。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 同一次进程内只 import 一次；缺依赖时不阻塞宿主启动。 */
let generatorCtor = null;

async function loadGenerator() {
  if (generatorCtor) return generatorCtor;
  const module = await import('@soullink-emotion/profile-generator');
  generatorCtor = module.Live2DProfileAutoGenerator;
  if (typeof generatorCtor !== 'function') throw new Error('profile-generator 未导出 Live2DProfileAutoGenerator');
  return generatorCtor;
}

const mtimeOf = async path => {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * @param {object} request
 * @param {string} request.modelsRoot  模型根目录（~/.dsh/live2d-deskpet/models）
 * @param {string} request.modelDirName 模型子目录名（registry 里的相对路径）
 * @param {string} request.model3Path  该模型的 .model3.json 绝对路径，用于判新旧
 * @param {string} request.cdi3Path    该模型的 .cdi3.json 绝对路径（可能不存在）
 * @param {string} request.cachePath   缓存落盘路径
 * @param {(msg: string) => void} [request.log]
 * @returns {Promise<{ body: string, generated: boolean, provider: string } | null>}
 */
export async function ensureSoullinkProfile({ modelsRoot, modelDirName, model3Path, cdi3Path, cachePath, log }) {
  const cachedBody = await readFile(cachePath, 'utf8').catch(() => null);
  const cacheTime = await mtimeOf(cachePath);
  const sourceTime = Math.max(await mtimeOf(model3Path), cdi3Path ? await mtimeOf(cdi3Path) : 0);
  if (cachedBody && cacheTime >= sourceTime) {
    return { body: cachedBody, generated: false, provider: 'cache' };
  }

  const Generator = await loadGenerator();
  const generator = new Generator({ modelsRoot });
  const result = await generator.ensure({ modelDir: modelDirName });
  if (!result?.profile) return null;

  const body = JSON.stringify(result.profile);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, body, 'utf8');
  log?.(`soullink profile 已生成（${result.provider}，${body.length} B）：${cachePath}`);
  return { body, generated: true, provider: String(result.provider ?? 'unknown') };
}
