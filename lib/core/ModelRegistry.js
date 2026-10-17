import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
export class ModelRegistry {
    root;
    constructor(root) {
        this.root = root;
    }
    async scan() {
        await mkdir(this.root, { recursive: true });
        const results = [];
        await this.walk(this.root, results);
        return results.sort((a, b) => a.name.localeCompare(b.name));
    }
    async importFolder(source) {
        const models = await this.findModelFiles(resolve(source));
        if (models.length !== 1)
            throw new Error('导入目录必须且只能包含一个 .model3.json 模型定义文件。');
        const sourceRoot = dirname(models[0]);
        const id = `${basename(sourceRoot).replace(/[^a-zA-Z0-9_-]/g, '-')}-${createHash('sha1').update(sourceRoot).digest('hex').slice(0, 8)}`;
        const destination = join(this.root, id);
        await cp(sourceRoot, destination, { recursive: true, force: true, errorOnExist: false });
        return this.info(join(destination, basename(models[0])), destination);
    }
    /**
     * Delete one model's folder. The folder must resolve inside the registry
     * root, so a malformed id can never aim the deletion elsewhere.
     * @param id - the model id `scan()` reported.
     * @throws when no model with that id exists or its folder escapes the root.
     */
    async remove(id) {
        const model = (await this.scan()).find(candidate => candidate.id === id);
        if (!model)
            throw new Error(`未找到模型：${id}`);
        const inside = relative(this.root, model.root);
        if (!inside || inside.startsWith('..'))
            throw new Error('拒绝删除模型目录之外的内容。');
        await rm(model.root, { recursive: true, force: true });
    }
    /**
     * The model's first texture as named by its `.model3.json`, when the file
     * lists one. Informational: consumers decide how to surface it.
     */
    async thumbnailOf(model) {
        try {
            const parsed = JSON.parse(await readFile(model.modelPath, 'utf8'));
            return parsed.FileReferences?.Textures?.[0];
        }
        catch {
            return undefined;
        }
    }
    async walk(folder, results) {
        for (const entry of await readdir(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory())
                await this.walk(path, results);
            else if (entry.isFile() && entry.name.endsWith('.model3.json'))
                results.push(await this.info(path, dirname(path)));
        }
    }
    async findModelFiles(folder) {
        const found = [];
        const visit = async (path) => {
            for (const entry of await readdir(path, { withFileTypes: true })) {
                const next = join(path, entry.name);
                if (entry.isDirectory())
                    await visit(next);
                else if (entry.name.endsWith('.model3.json'))
                    found.push(next);
            }
        };
        await visit(folder);
        return found;
    }
    async info(modelPath, root) {
        let name = basename(root);
        try {
            name = JSON.parse(await readFile(modelPath, 'utf8')).FileReferences?.Moc ? basename(root) : name;
        }
        catch { /* renderer will report malformed model */ }
        return { id: createHash('sha1').update(modelPath).digest('hex').slice(0, 12), name, modelPath, root };
    }
}
