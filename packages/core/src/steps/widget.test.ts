import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { widgetStep } from './widget.js';
import type { StepContext } from './types.js';
import type { StepDef } from '../core/types.js';
import { DEFAULT_PROVIDED } from '../core/module-loader.js';

function makeCtx(overrides: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {},
    env: {},
    steps: {},
    with: {},
    provider: {} as StepContext['provider'],
    baseDir: '/home/chris/GitHub/plyflow/workflows',
    isTty: true,
    provided: DEFAULT_PROVIDED,
    emit: vi.fn(),
    prompt: vi.fn().mockResolvedValue('widget-result'),
    loadModule: vi.fn(),
    ...overrides,
  };
}

function makeDef(widget: string, extra: Partial<StepDef> = {}): StepDef {
  return { id: 'my-widget', widget, ...extra };
}

describe('widgetStep.match', () => {
  it('matches when def.widget is defined', () => {
    expect(widgetStep.match(makeDef('./MyWidget.tsx'))).toBe(true);
  });

  it('does not match when def.widget is undefined', () => {
    expect(widgetStep.match({ id: 'no-widget' })).toBe(false);
  });
});

describe('widgetStep.parse', () => {
  it('captures module, stepId, hasDefault=false when no default', () => {
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx'));
    expect(cfg).toMatchObject({
      module: './MyWidget.tsx',
      stepId: 'my-widget',
      hasDefault: false,
      defaultValue: undefined,
    });
  });

  it('captures hasDefault=true and defaultValue when default is present', () => {
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx', { default: 42 }));
    expect(cfg).toMatchObject({
      module: './MyWidget.tsx',
      stepId: 'my-widget',
      hasDefault: true,
      defaultValue: 42,
    });
  });
});

describe('widgetStep.run — TTY mode', () => {
  it('sends a widget UiRequest with the absolute module path and ctx.with as props', async () => {
    const withProps = { foo: 'bar', count: 3 };
    const prompt = vi.fn().mockResolvedValue('widget-resolved');
    const ctx = makeCtx({ isTty: true, with: withProps, prompt, baseDir: '/base/dir' });
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx'));

    const result = await widgetStep.run(cfg, ctx);

    expect(prompt).toHaveBeenCalledOnce();
    const req = prompt.mock.calls[0][0];
    expect(req.kind).toBe('widget');
    expect(req.module).toBe(path.resolve('/base/dir', './MyWidget.tsx'));
    expect(req.baseDir).toBe('/base/dir');
    expect(req.props).toBe(withProps);
    expect(req.provided).toEqual(DEFAULT_PROVIDED);
    expect(result).toEqual({ output: 'widget-resolved' });
  });

  it('resolves an absolute widget path unchanged', async () => {
    const prompt = vi.fn().mockResolvedValue('resolved');
    const ctx = makeCtx({ isTty: true, prompt, baseDir: '/base/dir' });
    const cfg = widgetStep.parse(makeDef('/abs/path/Widget.tsx'));

    await widgetStep.run(cfg, ctx);

    const req = prompt.mock.calls[0][0];
    expect(req.module).toBe('/abs/path/Widget.tsx');
  });

  it('forwards custom provided set from ctx into the widget UiRequest', async () => {
    const customProvided = ['zod', 'react', 'ink', 'my-custom-lib'];
    const prompt = vi.fn().mockResolvedValue('resolved');
    const ctx = makeCtx({ isTty: true, prompt, baseDir: '/base/dir', provided: customProvided });
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx'));

    await widgetStep.run(cfg, ctx);

    const req = prompt.mock.calls[0][0];
    expect(req.provided).toEqual(customProvided);
  });
});

describe('widgetStep.run — non-TTY mode', () => {
  it('returns default value without calling prompt when isTty=false and default is present', async () => {
    const prompt = vi.fn();
    const ctx = makeCtx({ isTty: false, prompt });
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx', { default: 'fallback' }));

    const result = await widgetStep.run(cfg, ctx);

    expect(prompt).not.toHaveBeenCalled();
    expect(result).toEqual({ output: 'fallback' });
  });

  it('returns falsy default value (0) correctly', async () => {
    const ctx = makeCtx({ isTty: false });
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx', { default: 0 }));
    const result = await widgetStep.run(cfg, ctx);
    expect(result).toEqual({ output: 0 });
  });

  it('throws when isTty=false and no default', async () => {
    const ctx = makeCtx({ isTty: false });
    const cfg = widgetStep.parse(makeDef('./MyWidget.tsx'));

    await expect(widgetStep.run(cfg, ctx)).rejects.toThrow(/TTY|default/);
  });

  it('error message includes the step id', async () => {
    const ctx = makeCtx({ isTty: false });
    const cfg = widgetStep.parse({ id: 'choose-color', widget: './ColorPicker.tsx' });

    await expect(widgetStep.run(cfg, ctx)).rejects.toThrow(/choose-color/);
  });
});
