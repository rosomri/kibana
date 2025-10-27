/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useState } from 'react';
import {
  EuiBadge,
  EuiBadgeGroup,
  EuiButton,
  EuiEmptyPrompt,
  EuiPopover,
  EuiText,
} from '@elastic/eui';
import * as i18n from '../../connectors/workflows/translations';

export const WorkflowTagsBadge: React.FC<{ tags: string[] }> = ({ tags }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  if (tags.length === 0) {
    return null;
  }

  const handlePopoverToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setIsPopoverOpen(!isPopoverOpen);
  };

  return (
    <EuiPopover
      button={
        <EuiBadge
          color="hollow"
          iconType="tag"
          onClick={handlePopoverToggle}
          onClickAriaLabel="Show tags"
          style={{ cursor: 'pointer' }}
        >
          {tags.length}
        </EuiBadge>
      }
      isOpen={isPopoverOpen}
      closePopover={() => setIsPopoverOpen(false)}
      panelPaddingSize="s"
      anchorPosition="downLeft"
    >
      <EuiBadgeGroup>
        {tags.map((tag) => (
          <EuiBadge key={tag} color="hollow" style={{ maxWidth: '150px' }}>
            {tag}
          </EuiBadge>
        ))}
      </EuiBadgeGroup>
    </EuiPopover>
  );
};

export const WorkflowEmptyState: React.FC<{ onCreateWorkflow: () => void }> = ({ onCreateWorkflow }) => {
  return (
    <EuiEmptyPrompt
      title={
        <EuiText textAlign="center" color="textParagraph">
          {i18n.EMPTY_STATE_TITLE}
        </EuiText>
      }
      titleSize="s"
      body={i18n.EMPTY_STATE_DESCRIPTION}
      actions={
        <EuiButton
          color="primary"
          fill={false}
          onClick={onCreateWorkflow}
          iconType="plusInCircle"
          size="s"
          disabled={false}
          isLoading={false}
        >
          {i18n.EMPTY_STATE_BUTTON_TEXT}
        </EuiButton>
      }
      paddingSize="l"
    />
  );
};
