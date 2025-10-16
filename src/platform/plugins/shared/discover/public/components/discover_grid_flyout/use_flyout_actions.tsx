/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import { useMemo } from 'react';
import type { DataTableRecord } from '@kbn/discover-utils/types';
import type { FlyoutActionItem, FlyoutCustomization } from '../../customizations';
import type { UseNavigationProps } from '../../hooks/use_navigation_props';
import { useNavigationProps } from '../../hooks/use_navigation_props';
import type { DiscoverServices } from '../../build_services';

interface UseFlyoutActionsParams extends UseNavigationProps {
  actions?: FlyoutCustomization['actions'];
  services?: DiscoverServices;
  document?: DataTableRecord;
}

export const useFlyoutActions = ({
  actions,
  services,
  document,
  ...props
}: UseFlyoutActionsParams): { flyoutActions: FlyoutActionItem[] } => {
  const { dataView } = props;
  const { singleDocHref, contextViewHref, onOpenSingleDoc, onOpenContextView } =
    useNavigationProps(props);

  const {
    viewSingleDocument = { disabled: false },
    viewSurroundingDocument = { disabled: false },
  } = actions?.defaultActions ?? {};
  const customActions = [...(actions?.getActionItems?.() ?? [])];

  // Create workflow action if workflowsManagement plugin is available
  const workflowAction = useMemo<FlyoutActionItem | null>(() => {
    if (!services || !document || !services.workflowsManagement) {
      return null;
    }

    // Access the helper function from the plugin start contract
    const createWorkflowFlyoutAction = services.workflowsManagement.createWorkflowFlyoutAction;

    if (typeof createWorkflowFlyoutAction === 'function') {
      return createWorkflowFlyoutAction({
        core: services.core,
        document,
        dataViewId: dataView.id,
        dataViewTitle: dataView.title,
      });
    }

    return null;
  }, [services, document, dataView.id, dataView.title]);

  const flyoutActions: FlyoutActionItem[] = [
    {
      id: 'singleDocument',
      enabled: !viewSingleDocument.disabled,
      dataTestSubj: 'docTableRowAction',
      iconType: 'document',
      href: singleDocHref,
      onClick: onOpenSingleDoc,
      label: i18n.translate('discover.grid.tableRow.viewSingleDocumentLinkLabel', {
        defaultMessage: 'View single document',
      }),
    },
    {
      id: 'surroundingDocument',
      enabled: Boolean(!viewSurroundingDocument.disabled && dataView.isTimeBased() && dataView.id),
      dataTestSubj: 'docTableRowAction',
      iconType: 'documents',
      href: contextViewHref,
      onClick: onOpenContextView,
      label: i18n.translate('discover.grid.tableRow.viewSurroundingDocumentsLinkLabel', {
        defaultMessage: 'View surrounding documents',
      }),
      helpText: i18n.translate('discover.grid.tableRow.viewSurroundingDocumentsHover', {
        defaultMessage:
          'Inspect documents that occurred before and after this document. Only pinned filters remain active in the Surrounding documents view.',
      }),
    },
    ...(workflowAction ? [workflowAction] : []),
    ...customActions,
  ];

  return { flyoutActions: flyoutActions.filter((action) => action.enabled) };
};
