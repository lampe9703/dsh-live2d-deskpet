import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMORY_FILE, MEMORY_FILE_MAX_LINES, buildTurn, parseTurns, serializeTurns } from '../../shared/companion-memory.js';
/**
 * 陪伴记忆的文件层：turns.jsonl 的读取、原子追加与清空。
 *
 * 设计约束（0.1.7）：
 *   - **所有方法都不抛**：记忆是陪伴链路的增强，不是依赖。读写失败一律静默
 *     降级（返回空 / false，附一行日志），绝不影响截屏、推理、发言主链路。
 *   - **不做内存缓存**：宿主进程（设置页的"清空 / 条目数"）与 Electron 进程
 *     （逐轮追加）读写的是同一个文件。每次调用都现读磁盘，文件只有几 KB，
 *     而陪伴间隔最小 10 秒，这点开销换来了两侧永远看到同一份事实。
 *   - **写入用临时文件 + rename**：进程在写一半时被杀，留下的要么是完整的
 *     旧文件、要么是完整的新文件，不会出现半行 JSON。rename 在 Windows 上
 *     原子替换既有目标。
 *   - 路径由调用方注入（构造参数），本类不猜任何目录；CompanionService 通过
 *     deps.memory 拿到实例，与 takeScreenshot / foreground / say 同一种模式。
 */
export class MemoryStore {
    #dir;
    #log;
    /**
     * @param dir - 记忆目录（~/.dsh/live2d-deskpet/memory）。
     * @param options.log - 可选日志回调，只用于写失败这类值得留一行的事件。
     */
    constructor(dir, options = {}) {
        this.#dir = String(dir ?? '');
        this.#log = typeof options.log === 'function' ? options.log : () => { };
    }
    /** 记忆文件的完整路径。 */
    get file() {
        return join(this.#dir, MEMORY_FILE);
    }
    /**
     * 读回全部有效轮次。
     *
     * 文件不存在、目录不存在、内容整体损坏，都返回空数组——"坏记忆 = 无记忆"。
     */
    async read() {
        try {
            return parseTurns(await readFile(this.file, 'utf8'));
        }
        catch {
            return [];
        }
    }
    /** 当前有效条目数（设置页显示用）。 */
    async count() {
        return (await this.read()).length;
    }
    /**
     * 追加一轮。写入前整条过 buildTurn（脱敏 + 截断），文件按行数硬上限收敛。
     * @returns 写入是否成功；失败只记日志，不抛。
     */
    async append(turn) {
        try {
            const turns = await this.read();
            turns.push(buildTurn(turn ?? {}));
            await this.#write(turns.slice(-MEMORY_FILE_MAX_LINES));
            return true;
        }
        catch (error) {
            this.#log(`陪伴记忆写入失败（本轮照常，仅缺记忆）：${String(error?.message ?? error)}`);
            return false;
        }
    }
    /**
     * 一键清空：把文件写成空内容（同样走临时文件 + rename）。
     * @returns 是否成功；失败只记日志，不抛。
     */
    async clear() {
        try {
            await this.#write([]);
            this.#log('陪伴记忆已清空。');
            return true;
        }
        catch (error) {
            this.#log(`陪伴记忆清空失败：${String(error?.message ?? error)}`);
            return false;
        }
    }
    /** 临时文件 + rename 的原子写；目录不存在时现建。 */
    async #write(turns) {
        await mkdir(this.#dir, { recursive: true });
        const target = this.file;
        const temp = `${target}.tmp`;
        await writeFile(temp, serializeTurns(turns), 'utf8');
        await rename(temp, target);
    }
}
