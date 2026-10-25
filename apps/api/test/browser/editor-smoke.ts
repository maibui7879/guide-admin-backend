import { MediaStorage } from '../../src/modules/media/media-storage';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import root from '../../src/database/data-source';
import { parseEnvironment } from '../../src/config/env';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/common/http/configure-http';
import { UsersService } from '../../src/modules/auth/services/users.service';
import { CatalogWriterService } from '../../src/modules/catalog/services/catalog-writer.service';

async function run() {
  console.log('Browser test: initializing isolated database');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const env = parseEnvironment(process.env);
  const opts = {
    ...root.options,
    schema,
    extra: { options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 },
  };
  const db = new DataSource(opts);
  await root.initialize();
  await root.query(`CREATE SCHEMA "${schema}"`);
  let chrome: ReturnType<typeof spawn> | undefined;
  let web: ReturnType<typeof spawn> | undefined;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let socket: WebSocket | undefined;
  try {
    await db.initialize();
    console.log('Browser test: applying migrations');
    await db.runMigrations();
    const users = new UsersService(db);
    await users.create(
      {
        email: 'browser-editor@example.com',
        password: 'Synthetic browser-only password 123!',
        roles: ['ADMIN'],
      },
      true,
    );
    const writer = new CatalogWriterService(db);
    await users.create({
      email: 'browser-reviewer@example.com',
      password: 'Synthetic browser-only password 456!',
      roles: ['ADMIN'],
    });
    const game = await writer.createGame({ slug: 'stella-sora', name: 'Stella Sora' });
    await writer.writeCharacter(game.id, {
      slug: 'fixture',
      name: 'Browser fixture',
      rarity: 5,
      element: 'Aqua',
      status: 'published',
      sourceUrl: 'https://example.com/browser',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    });
    app = await NestFactory.create(
      AppModule.register(db, {
        ...env,
        API_ORIGIN: 'http://localhost:3005',
        CORS_ORIGINS: ['http://localhost:3004'],
      }),
      { logger: false, bodyParser: false },
    );
    configureHttp(app, {
      ...env,
      API_ORIGIN: 'http://localhost:3005',
      CORS_ORIGINS: ['http://localhost:3004'],
      LOG_LEVEL: 'silent',
    });
    await app.listen(3005, '127.0.0.1');
    console.log('Browser test: API listening');
    web = spawn('python', ['server.py'], {
      cwd: resolve(__dirname, '../../../web'),
      env: {
        ...process.env,
        WEB_PORT: '3004',
        API_URL: 'http://localhost:3005',
        EDITOR_API_ORIGIN: 'http://localhost:3005',
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    const profile = resolve(__dirname, '../../../../.cache/browser-' + randomUUID());
    await mkdir(profile, { recursive: true });
    chrome = spawn(
      process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--remote-debugging-port=9227',
        '--user-data-dir=' + profile,
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let n = 0; n < 60; n++) {
      try {
        const rows = (await (await fetch('http://localhost:9227/json')).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[];
        target = rows.find((row) => row.type === 'page');
        if (target) break;
      } catch {
        /* Chrome booting */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!target) throw Error('Chrome did not start');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((ok, fail) => {
      socket!.addEventListener('open', () => ok(), { once: true });
      socket!.addEventListener('error', () => fail(Error('Chrome connection failed')), {
        once: true,
      });
    });
    let sequence = 0;
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const errors: string[] = [];
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(String(event.data));
      if (data.id) {
        const task = pending.get(data.id);
        if (!task) return;
        pending.delete(data.id);
        if (data.error) task.reject(Error(data.error.message));
        else task.resolve(data.result);
      } else if (data.method === 'Runtime.exceptionThrown')
        errors.push(data.params.exceptionDetails.text);
    });
    const send = (method: string, params: unknown = {}) =>
      new Promise<Record<string, unknown>>((ok, fail) => {
        const id = ++sequence;
        pending.set(id, { resolve: (value) => ok(value as Record<string, unknown>), reject: fail });
        socket!.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression: string) => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return (result.result as { value: unknown }).value;
    };
    const wait = async (expression: string) => {
      for (let n = 0; n < 100; n++) {
        if (await evaluate(expression)) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw Error(
        'Timed out: ' +
          expression +
          '; ' +
          (await evaluate("document.getElementById('status')?.textContent")),
      );
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url: 'http://localhost:3004/admin/editor/' });
    await wait("!!document.querySelector('.tiptap')");
    await evaluate(
      "document.getElementById('email').value='browser-editor@example.com';document.getElementById('password').value='Synthetic browser-only password 123!';document.getElementById('login').requestSubmit();true",
    );
    await wait(
      "!document.getElementById('workspace').hidden && !!document.getElementById('target').value && !document.getElementById('save').disabled",
    );
    const rejected = await evaluate(
      `(async()=>{const identity=await(await fetch('http://localhost:3005/api/v1/admin/auth/session',{credentials:'include'})).json();const data=new FormData();data.append('file',new File(['<svg onload="alert(1)"/>'],'fake.png',{type:'image/png'}));const response=await fetch('http://localhost:3005/api/v1/admin/games/${game.id}/media',{method:'POST',credentials:'include',headers:{'X-CSRF-Token':identity.data.csrfToken},body:data});return response.status;})()`,
    );
    if (rejected !== 400) throw Error('Spoofed image was accepted');
    await evaluate(
      "document.getElementById('title').value='Guide editor browser test';document.getElementById('description').value='A guide with a cover, headings and an inline diagram.';document.getElementById('slug').value='browser-guide';document.getElementById('image-alt').value='Illustration from browser';document.getElementById('image-caption').value='Diagram caption';document.querySelector('.tiptap').focus();document.execCommand('insertText',false,'Paragraph before the illustration.');true",
    );
    const upload =
      "async function insert(field){const canvas=document.createElement('canvas');canvas.width=96;canvas.height=48;const c=canvas.getContext('2d');c.fillStyle='#5e78cd';c.fillRect(0,0,96,48);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'diagram.png',{type:'image/png'}));const input=document.getElementById(field);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));} ";
    await evaluate('(async()=>{' + upload + "await insert('image-file');return true;})()");
    await wait(
      "!!document.querySelector('.tiptap figure img') && !document.getElementById('save').disabled",
    );
    await evaluate('(async()=>{' + upload + "await insert('cover-file');return true;})()");
    await wait(
      "!!document.querySelector('#cover-preview img') && !document.getElementById('save').disabled",
    );
    await evaluate(
      "document.getElementById('cover-alt').value='Cover from browser';document.getElementById('cover-caption').value='Cover caption';document.getElementById('save').click();true",
    );
    await wait(
      "document.getElementById('page-state').textContent.startsWith('draft') && !document.getElementById('save').disabled",
    );
    await evaluate("document.getElementById('preview').click();true");
    await wait(
      "document.getElementById('preview-dialog').open && document.querySelectorAll('#preview-content img').length===2",
    );
    await wait(
      "[...document.querySelectorAll('#preview-content img')].every(img=>img.complete&&img.naturalWidth>0)",
    );
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      resolve(__dirname, '../../../../.cache/editor-smoke.png'),
      Buffer.from(screenshot.data as string, 'base64'),
    );
    await evaluate(
      "document.getElementById('close-preview').click();document.getElementById('submit').click();true",
    );
    await wait(
      "document.getElementById('page-state').textContent.startsWith('in_review') && !document.getElementById('history').disabled",
    );
    if (!(await evaluate("document.getElementById('approve').disabled")))
      throw Error('Self approval was enabled');
    await evaluate("document.getElementById('logout').click();true");
    await wait(
      "!!document.querySelector('.tiptap') && !document.getElementById('login-panel').hidden",
    );
    await evaluate(
      "document.getElementById('email').value='browser-reviewer@example.com';document.getElementById('password').value='Synthetic browser-only password 456!';document.getElementById('login').requestSubmit();true",
    );
    await wait(
      "!document.getElementById('workspace').hidden && document.querySelectorAll('#page-list tr').length===1 && !document.getElementById('load').disabled",
    );
    await evaluate("document.querySelector('#page-list button').click();true");
    await wait(
      "document.getElementById('page-state').textContent.startsWith('in_review') && !document.getElementById('approve').disabled",
    );
    await evaluate(
      "document.getElementById('review-reason').value='Please clarify the strategy.';document.getElementById('return-draft').click();true",
    );
    await wait(
      "document.getElementById('page-state').textContent.startsWith('draft') && !document.getElementById('submit').disabled",
    );
    await evaluate("document.getElementById('history').click();true");
    await wait(
      "document.getElementById('history-dialog').open && document.getElementById('audit-list').textContent.includes('Please clarify the strategy.')",
    );
    await evaluate(
      "document.getElementById('close-history').click();document.getElementById('submit').click();true",
    );
    await wait(
      "document.getElementById('page-state').textContent.startsWith('in_review') && !document.getElementById('approve').disabled",
    );
    await evaluate("document.getElementById('approve').click();true");
    await wait(
      "document.getElementById('page-state').textContent.startsWith('approved') && !document.getElementById('publish').disabled",
    );
    await evaluate("document.getElementById('publish').click();true");
    await wait(
      "document.getElementById('page-state').textContent.startsWith('published') && !document.getElementById('public-link').hidden && !document.getElementById('history').disabled",
    );
    const publicPage = await fetch('http://localhost:3004/guides/browser-guide/');
    const publicHtml = await publicPage.text();
    if (
      !publicPage.ok ||
      !publicHtml.includes('Guide editor browser test') ||
      !publicHtml.includes('/api/v1/media/')
    )
      throw Error('Published guide was not rendered on the public website');
    await evaluate("document.getElementById('history').click();true");
    await wait(
      "document.getElementById('history-dialog').open && !!document.querySelector('[data-restore]') && !document.querySelector('[data-restore]').disabled",
    );
    await evaluate("window.confirm=()=>true;document.querySelector('[data-restore]').click();true");
    await wait(
      "!document.getElementById('history-dialog').open && document.getElementById('page-state').textContent.startsWith('draft') && !document.getElementById('unpublish').disabled",
    );
    if ((await fetch('http://localhost:3004/guides/browser-guide/')).status !== 200)
      throw Error('Restoring draft hid the publication');
    await evaluate("document.getElementById('unpublish').click();true");
    await wait(
      "document.getElementById('public-link').hidden && !document.getElementById('history').disabled",
    );
    if (
      (await fetch('http://localhost:3005/api/v1/games/stella-sora/guides/browser-guide'))
        .status !== 404
    )
      throw Error('Unpublished guide remained public');
    await evaluate("document.getElementById('new').click();true");
    await wait("!document.getElementById('find-wiki').disabled");
    await evaluate("document.getElementById('find-wiki').click();true");
    await wait(
      "document.getElementById('slug').value==='browser-guide' && document.getElementById('find-wiki').disabled && !document.getElementById('history').disabled",
    );
    await evaluate(
      "document.getElementById('queue-state').value='in_review';document.getElementById('queue-state').dispatchEvent(new Event('change'));true",
    );
    await wait(
      "document.querySelectorAll('#page-list tr').length===0 && !document.getElementById('refresh-pages').disabled",
    );
    await evaluate(
      "document.getElementById('queue-state').value='';document.getElementById('queue-state').dispatchEvent(new Event('change'));true",
    );
    await wait(
      "document.querySelectorAll('#page-list tr').length===1 && !document.getElementById('refresh-pages').disabled",
    );
    if (errors.length) throw Error('Browser exceptions: ' + errors.join(','));
    console.log(
      'Browser smoke passed: editor/media, two-account review, feedback, publish to public page, restore preserving publication and unpublish.',
    );
  } finally {
    socket?.close();
    chrome?.kill();
    web?.kill();
    if (app && db.isInitialized) {
      const assets = (await db.query('SELECT storage_key FROM media_assets')) as {
        storage_key: string;
      }[];
      const storage = app.get(MediaStorage);
      await Promise.allSettled(assets.map((asset) => storage.remove(asset.storage_key)));
    }
    if (app) await app.close();
    if (db.isInitialized) await db.destroy();
    await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root.destroy();
  }
}
void run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Browser smoke failed');
  process.exitCode = 1;
});
