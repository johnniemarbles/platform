import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LessonContentValidationError,
  isLessonContentDocument,
  validateLessonContentDocument,
} from '../src/content-block.ts';

const assetId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

test('validates and normalizes a mixed lesson content document', () => {
  const document = validateLessonContentDocument({
    schemaVersion: 1,
    blocks: [
      { id: 'intro.heading', type: 'HEADING', position: 1, data: { text: 'Welcome', level: 2 } },
      {
        id: 'hero-image',
        type: 'IMAGE',
        position: 2,
        data: { assetId },
        accessibility: { label: 'A learner opening the course' },
      },
      {
        id: 'resource',
        type: 'RESOURCE',
        position: 3,
        data: { assetId, title: 'Reference guide' },
      },
    ],
  });

  assert.equal(document.schemaVersion, 1);
  assert.equal(document.blocks.length, 3);
  assert.equal(document.blocks[0]?.type, 'HEADING');
  assert.equal(isLessonContentDocument(document), true);
});

test('fails closed on unsupported versions and unknown block types', () => {
  assert.throws(
    () => validateLessonContentDocument({ schemaVersion: 2, blocks: [] }),
    (error: unknown) => error instanceof LessonContentValidationError
      && error.code === 'UNSUPPORTED_SCHEMA_VERSION',
  );
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [{ id: 'x', type: 'RAW_HTML', position: 1, data: {} }],
    }),
    /Unknown lesson content block type/,
  );
});

test('requires stable unique ids and positions', () => {
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [
        { id: 'same', type: 'RICH_TEXT', position: 1, data: { text: 'One' } },
        { id: 'same', type: 'RICH_TEXT', position: 2, data: { text: 'Two' } },
      ],
    }),
    /Block ids must be unique/,
  );
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [
        { id: 'one', type: 'RICH_TEXT', position: 1, data: { text: 'One' } },
        { id: 'two', type: 'RICH_TEXT', position: 1, data: { text: 'Two' } },
      ],
    }),
    /positions must be unique/,
  );
});

test('requires accessible images unless explicitly decorative', () => {
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [{ id: 'image', type: 'IMAGE', position: 1, data: { assetId } }],
    }),
    (error: unknown) => error instanceof LessonContentValidationError
      && error.code === 'IMAGE_ALT_REQUIRED',
  );
  assert.doesNotThrow(() => validateLessonContentDocument({
    schemaVersion: 1,
    blocks: [{
      id: 'decorative',
      type: 'IMAGE',
      position: 1,
      data: { assetId },
      accessibility: { decorative: true },
    }],
  }));
});

test('rejects unsafe URLs, unknown fields and oversized structures', () => {
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [{
        id: 'embed',
        type: 'EMBED',
        position: 1,
        data: { url: 'javascript:alert(1)', title: 'Unsafe' },
      }],
    }),
    (error: unknown) => error instanceof LessonContentValidationError
      && error.code === 'UNSAFE_URL',
  );
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [{ id: 'text', type: 'RICH_TEXT', position: 1, data: { text: 'Hello', html: '<b>Hello</b>' } }],
    }),
    (error: unknown) => error instanceof LessonContentValidationError
      && error.code === 'UNKNOWN_FIELD',
  );
});

test('validates canonical asset references and namespaced extensions', () => {
  assert.throws(
    () => validateLessonContentDocument({
      schemaVersion: 1,
      blocks: [{ id: 'file', type: 'DOCUMENT', position: 1, data: { assetId: 'local-path', title: 'File' } }],
    }),
    /UUID asset reference/,
  );
  assert.doesNotThrow(() => validateLessonContentDocument({
    schemaVersion: 1,
    blocks: [{
      id: 'extension',
      type: 'EXTENSION',
      position: 1,
      data: { extensionKey: 'dentex.clinical-simulation', payload: { mode: 'guided' } },
    }],
  }));
});
