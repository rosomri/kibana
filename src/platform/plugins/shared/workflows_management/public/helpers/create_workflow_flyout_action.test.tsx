/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { createWorkflowFlyoutAction } from './create_workflow_flyout_action';
import type { CoreStart } from '@kbn/core/public';
import type { DataTableRecord } from '@kbn/discover-utils/types';

describe('createWorkflowFlyoutAction', () => {
  const mockDocument: DataTableRecord = {
    id: 'test-doc-1',
    raw: {
      _id: 'test-doc-1',
      _index: 'test-index',
      _source: {
        message: 'test message',
        host: { name: 'test-host' },
      },
    },
    flattened: {
      message: 'test message',
      'host.name': 'test-host',
    },
  } as DataTableRecord;

  const createMockCore = (hasExecutePermission: boolean): CoreStart => ({
    overlays: {
      openModal: jest.fn().mockReturnValue({
        close: jest.fn(),
      }),
    } as any,
    http: {
      post: jest.fn(),
    } as any,
    notifications: {
      toasts: {
        addSuccess: jest.fn(),
        addError: jest.fn(),
        addWarning: jest.fn(),
      },
    } as any,
    application: {
      capabilities: {
        workflowsManagement: {
          execute: hasExecutePermission,
        },
      },
    } as any,
  } as CoreStart);

  describe('Permission Checks', () => {
    it('should enable action when user has workflow:execute capability', () => {
      const core = createMockCore(true);
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      expect(action.enabled).toBe(true);
      expect(action.helpText).toContain('Execute a workflow using this document as input');
    });

    it('should disable action when user lacks workflow:execute capability', () => {
      const core = createMockCore(false);
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      expect(action.enabled).toBe(false);
      expect(action.helpText).toContain('You do not have permission to execute workflows');
    });

    it('should have correct action properties', () => {
      const core = createMockCore(true);
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
        dataViewId: 'test-data-view',
        dataViewTitle: 'Test Data View',
      });

      expect(action.id).toBe('runWorkflow');
      expect(action.iconType).toBe('play');
      expect(action.dataTestSubj).toBe('discoverRunWorkflowAction');
      expect(action.label).toBe('Run workflow');
    });
  });

  describe('onClick Behavior', () => {
    it('should open modal when user has permission', () => {
      const core = createMockCore(true);
      const mockModal = { close: jest.fn() };
      (core.overlays.openModal as jest.Mock).mockReturnValue(mockModal);
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      action.onClick();

      expect(core.overlays.openModal).toHaveBeenCalledTimes(1);
      // Verify modal was called with a MountPoint function
      expect(typeof (core.overlays.openModal as jest.Mock).mock.calls[0][0]).toBe('function');
    });

    it('should show warning toast when user without permission clicks action', () => {
      const core = createMockCore(false);
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      action.onClick();

      expect(core.notifications.toasts.addWarning).toHaveBeenCalledTimes(1);
      expect(core.notifications.toasts.addWarning).toHaveBeenCalledWith({
        title: 'Permission denied',
        text: expect.stringContaining('You do not have permission to execute workflows'),
      });
      expect(core.overlays.openModal).not.toHaveBeenCalled();
    });

    it('should not open modal when user lacks permission', () => {
      const core = createMockCore(false);
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      action.onClick();

      expect(core.overlays.openModal).not.toHaveBeenCalled();
    });
  });

  describe('Data View Context', () => {
    it('should pass data view context to the action', () => {
      const core = createMockCore(true);
      const dataViewId = 'logs-*';
      const dataViewTitle = 'Logs Data View';
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
        dataViewId,
        dataViewTitle,
      });

      expect(action).toBeDefined();
      // Data view context is passed to executeWorkflowFromDocument
      // which is tested separately
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined capabilities gracefully', () => {
      const core = {
        ...createMockCore(false),
        application: {
          capabilities: {},
        } as any,
      };
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      expect(action.enabled).toBe(false);
    });

    it('should handle missing workflowsManagement capability', () => {
      const core = {
        ...createMockCore(false),
        application: {
          capabilities: {
            workflowsManagement: undefined,
          },
        } as any,
      };
      
      const action = createWorkflowFlyoutAction({
        core,
        document: mockDocument,
      });

      expect(action.enabled).toBe(false);
    });
  });
});

