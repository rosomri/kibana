/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v 1".
 */

import { generateFilterStepSnippet } from './generate_filter_step_snippet';

describe('generateFilterStepSnippet', () => {
  describe('where_exp filter', () => {
    it('should generate correct snippet for where_exp filter', () => {
      const snippet = generateFilterStepSnippet('filter.where_exp');
      
      expect(snippet).toContain('filter.where_exp');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('exp: \'value > 50\'');
    });

    it('should generate full snippet with steps section', () => {
      const snippet = generateFilterStepSnippet('filter.where_exp', { full: true, withStepsSection: true });
      
      expect(snippet).toContain('steps:');
      expect(snippet).toContain('- name: filter_where_exp_step');
      expect(snippet).toContain('type: filter.where_exp');
    });
  });

  describe('concat filter', () => {
    it('should generate correct snippet for concat filter', () => {
      const snippet = generateFilterStepSnippet('filter.concat');
      
      expect(snippet).toContain('filter.concat');
      expect(snippet).toContain('path: \'{{ data.array1 }}\'');
      expect(snippet).toContain('other: \'{{ data.array2 }}\'');
    });
  });

  describe('format filter', () => {
    it('should generate correct snippet for format filter', () => {
      const snippet = generateFilterStepSnippet('filter.format');
      
      expect(snippet).toContain('filter.format');
      expect(snippet).toContain('path: \'{{ data.user.name }}\'');
      expect(snippet).toContain('template: \'Hello {{ value }}!\'');
    });
  });

  describe('limit filter', () => {
    it('should generate correct snippet for limit filter', () => {
      const snippet = generateFilterStepSnippet('filter.limit');
      
      expect(snippet).toContain('filter.limit');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('limit: 10');
    });
  });

  describe('sort filter', () => {
    it('should generate correct snippet for sort filter', () => {
      const snippet = generateFilterStepSnippet('filter.sort');
      
      expect(snippet).toContain('filter.sort');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('property: \'name\'');
      expect(snippet).toContain('order: \'asc\'');
    });
  });

  describe('map filter', () => {
    it('should generate correct snippet for map filter', () => {
      const snippet = generateFilterStepSnippet('filter.map');
      
      expect(snippet).toContain('filter.map');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('property: \'name\'');
    });
  });

  describe('group_by filter', () => {
    it('should generate correct snippet for group_by filter', () => {
      const snippet = generateFilterStepSnippet('filter.group_by');
      
      expect(snippet).toContain('filter.group_by');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('property: \'category\'');
    });
  });

  describe('first filter', () => {
    it('should generate correct snippet for first filter', () => {
      const snippet = generateFilterStepSnippet('filter.first');
      
      expect(snippet).toContain('filter.first');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).not.toContain('property:');
    });
  });

  describe('last filter', () => {
    it('should generate correct snippet for last filter', () => {
      const snippet = generateFilterStepSnippet('filter.last');
      
      expect(snippet).toContain('filter.last');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).not.toContain('property:');
    });
  });

  describe('size filter', () => {
    it('should generate correct snippet for size filter', () => {
      const snippet = generateFilterStepSnippet('filter.size');
      
      expect(snippet).toContain('filter.size');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).not.toContain('property:');
    });
  });

  describe('unique filter', () => {
    it('should generate correct snippet for unique filter', () => {
      const snippet = generateFilterStepSnippet('filter.unique');
      
      expect(snippet).toContain('filter.unique');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('property: \'id\'');
    });
  });

  describe('reverse filter', () => {
    it('should generate correct snippet for reverse filter', () => {
      const snippet = generateFilterStepSnippet('filter.reverse');
      
      expect(snippet).toContain('filter.reverse');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).not.toContain('property:');
    });
  });

  describe('join filter', () => {
    it('should generate correct snippet for join filter', () => {
      const snippet = generateFilterStepSnippet('filter.join');
      
      expect(snippet).toContain('filter.join');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('separator: \', \'');
    });
  });

  describe('split filter', () => {
    it('should generate correct snippet for split filter', () => {
      const snippet = generateFilterStepSnippet('filter.split');
      
      expect(snippet).toContain('filter.split');
      expect(snippet).toContain('path: \'{{ data.text }}\'');
      expect(snippet).toContain('separator: \',\'');
    });
  });

  describe('unknown filter', () => {
    it('should generate generic snippet for unknown filter', () => {
      const snippet = generateFilterStepSnippet('filter.unknown');
      
      expect(snippet).toContain('filter.unknown');
      expect(snippet).toContain('path: \'{{ data.items }}\'');
      expect(snippet).toContain('# Add filter-specific parameters here');
    });
  });

  describe('full snippet generation', () => {
    it('should generate full snippet without steps section', () => {
      const snippet = generateFilterStepSnippet('filter.where_exp', { full: true });
      
      expect(snippet).toContain('- name: filter_where_exp_step');
      expect(snippet).toContain('type: filter.where_exp');
      expect(snippet).not.toContain('steps:');
    });

    it('should generate full snippet with steps section', () => {
      const snippet = generateFilterStepSnippet('filter.where_exp', { full: true, withStepsSection: true });
      
      expect(snippet).toContain('steps:');
      expect(snippet).toContain('- name: filter_where_exp_step');
      expect(snippet).toContain('type: filter.where_exp');
    });
  });
});

