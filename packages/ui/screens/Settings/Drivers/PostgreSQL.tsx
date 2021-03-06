import React from 'react';
import GenericSettings from './lib/GenericSettings';

const PostgreSQL = ({ settings, updateSettings, ...props }) => (
  <GenericSettings settings={settings} updateSettings={updateSettings} {...props}/>
);
// @TODO: add driver specific settings here

export default PostgreSQL;