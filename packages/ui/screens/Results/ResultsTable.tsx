import * as React from 'react';
import * as L from 'leaflet';
import domtoimage from 'dom-to-image';
import FileSaver from "file-saver"
import { Paper, Drawer, List, ListItem, ListSubheader, ListItemText, Button } from '@material-ui/core';
import {
  SortingState,
  IntegratedSorting,
  FilteringState,
  IntegratedFiltering,
  DataTypeProvider,
  PagingState,
  IntegratedPaging,
  CustomPaging,
} from '@devexpress/dx-react-grid';

import {
  Grid,
  VirtualTable,
  TableHeaderRow,
  TableFilterRow,
  Table,
  TableColumnResizing,
  PagingPanel,
} from '@devexpress/dx-react-grid-material-ui';
import Code from '@material-ui/icons/Code';
import { toRegEx } from '@sqltools/ui/lib/utils';
import { ResultsTableProps } from './lib/ResultsTableProps';
import { filterPredicate } from './lib/filterPredicate';
import { availableFilterOperations, MenuActions } from './constants';
import { clipboardInsert } from '@sqltools/ui/lib/utils';
import getVscode from '../../lib/vscode';
import Menu from '../../components/Menu';
import ErrorIcon from '../../components/ErrorIcon';
import styled from 'styled-components';
import get from 'lodash/get';

const wkx = require('wkx');
let map = null;

const TableFilterRowCell = (props: TableFilterRow.CellProps) => (
  <TableFilterRow.Cell
    {...props}
    className={'filterCell ' + (props.filter && typeof props.filter.value !== 'undefined' ? 'active' : '')}
  />
);

const PagingPanelContainer = (buttons: React.ReactNode, showPagination: boolean) => (props: PagingPanel.ContainerProps) => (
  <div className="resultsPagination">
    {buttons}
    {showPagination && <div className="paginator">
      <PagingPanel.Container {...props} />
    </div>}
  </div>
);
const FilterIcon = ({ type, ...restProps }) => {
  if (type === 'regex') return <Code {...restProps} />;
  return <TableFilterRow.Icon type={type} {...restProps} />;
};

const ValueRender = ({ value }) => {
  {
    if (value === null) return <small>NULL</small>;
    if (value === true) return <span>TRUE</span>;
    if (value === false) return <span>FALSE</span>;
    if (typeof value === 'object' || Array.isArray(value)) {
      const objString = JSON.stringify(value, null, 2);
      return (
        <pre className="syntax json" data-value={value === null ? 'null' : objString}>{objString}</pre>
      );
    }
    value = String(value);
    return <span>{value}</span>;
    // DISABLE! Performance issues here
    // return <span>
    //   {
    //     value.replace(this.state.filtered[r.column.id].regex || this.state.filtered[r.column.id].value, '<###>$1<###>')
    //     .split('<###>')
    //     .map((str, i) => {
    //       if (i % 2 === 1)
    //         return (
    //           <mark key={i} className="filter-highlight">
    //             {str}
    //           </mark>
    //         );
    //       if (str.trim().length === 0) return null;
    //       return <span key={i}>{str}</span>;
    //     })
    //   }
    // </span>
  }
};

const TableCell = (openContextMenu: ResultsTable['openContextMenu']) => (props: Table.DataCellProps) => (
  <Table.Cell {...props} onContextMenu={e => openContextMenu(e, props.row, props.column, props.tableRow.key)}>
    <ValueRender value={props.value} />
  </Table.Cell>
);

const TableRow = selectedRow => (props: Table.DataRowProps) => (
  <Table.Row {...props} className={selectedRow === props.tableRow.key ? 'selected-row' : undefined} />
);

const GridRoot: typeof Grid.Root = styled(Grid.Root)`
  width: 100%;
  overflow: auto;
  height: 100%;
`;

const generateColumnExtensions = (colNames, rows) =>
  colNames.map(columnName => ({
    columnName,
    predicate: filterPredicate,
    width: Math.min(Math.max(
      20,
      JSON.stringify(get(rows, [0, columnName], '')).length - 2,
      JSON.stringify(get(rows, [1, columnName], '')).length - 2,
      JSON.stringify(get(rows, [2, columnName], '')).length - 2,
      JSON.stringify(get(rows, [3, columnName], '')).length - 2,
      JSON.stringify(get(rows, [4, columnName], '')).length - 2
    ) * 7.5, 600)
  })
);

export default class ResultsTable extends React.PureComponent<ResultsTableProps> {
  state = {
    filters: [],
    contextMenu: {
      row: null,
      rowKey: null,
      column: null,
      options: [],
      position: {},
    },
    columnExtensions: null,
    showMap: false,
    spatialData: null,
    spatialDataFormat : ''
  };

  changeFilters = (filters = []) => {
    filters = filters.map(filter => {
      if (filter.operation === 'regex')
        filter.regex = toRegEx(filter.value);
      return filter;
    });
    this.setState({ filters });
  };

  openContextMenu = (
    e: React.MouseEvent<HTMLElement> = undefined,
    row: any,
    column: Table.DataCellProps['column'],
    rowKey: any
  ) => {
    const options = this.tableContextOptions(row, column);
    if (!options || options.length === 0) return;
    this.setState({
      contextMenu: {
        row,
        rowKey,
        column,
        options,
        position: {
          pageX: e.pageX,
          pageY: e.pageY,
        },
      },
    });
  };

  invalidateMapOnResize = () => {
    !!map && map.invalidateSize();
    if(map) {
        map.invalidateSize();
        map.fitBounds(map.getBounds());
    }
  }

  onMenuSelect = (choice: string) => {
    const { contextMenu } = this.state;
    switch (choice) {
      case MenuActions.FilterByValueOption:
        const { filters = [] } = this.state;
        const filterIndex = filters.findIndex(filter => filter.columnName === contextMenu.column.name);
        if (filterIndex !== -1) filters.splice(filterIndex, 1);
        filters.push({
          columnName: contextMenu.column.name,
          operation: 'equal',
          value: contextMenu.row[contextMenu.column.name],
        });
        this.setState({
          filters,
        });
        break;
      case MenuActions.CopyCellOption:
        clipboardInsert(contextMenu.row[contextMenu.column.name]);
        break;
      case MenuActions.CopyRowOption:
        clipboardInsert(contextMenu.row || 'Failed');
        break;
      case MenuActions.ClearFiltersOption:
        this.setState({ filters: [] });
        break;
      case MenuActions.OpenEditorWithValueOption:
        getVscode().postMessage({
          action: 'call',
          payload: {
            command: `${process.env.EXT_NAME}.insertText`,
            args: [`${contextMenu.row[contextMenu.column.name]}`],
          },
        });
        break;
      case MenuActions.ShowOnMap:
      this.setState({showMap: true, spatialData: contextMenu.row[contextMenu.column.name]}, this.invalidateMapOnResize);
      break;
      case MenuActions.OpenEditorWithRowOption:
        getVscode().postMessage({
          action: 'call',
          payload: {
            command: `${process.env.EXT_NAME}.insertText`,
            args: [JSON.stringify(contextMenu.row, null, 2)],
          },
        });
        break;
      case MenuActions.ReRunQueryOption:
        getVscode().postMessage({
          action: 'call',
          payload: {
            command: `${process.env.EXT_NAME}.executeQuery`,
            args: [this.props.query, this.props.connId],
          },
        });
        break;
      case MenuActions.SaveCSVOption:
        getVscode().postMessage({
          action: 'call',
          payload: {
            command: `${process.env.EXT_NAME}.saveResults`,
            args: ['csv', this.props.connId],
          },
        });
        break;
      case MenuActions.SaveJSONOption:
        getVscode().postMessage({
          action: 'call',
          payload: {
            command: `${process.env.EXT_NAME}.saveResults`,
            args: ['json', this.props.connId],
          },
        });
        break;
    }
    this.setState({ contextMenu: {} });
  };

  updateWidths = (columnExtensions) => {
    this.setState({ columnExtensions });
  }

  tableContextOptions = (row: any, column: Table.DataCellProps['column']): any[] => {
    const options: any[] = [];
    let cellValue = row[column.name];
    const cellValueIsObject = cellValue && (Array.isArray(cellValue) || cellValue.toString() === '[object Object]');
    const replaceString = cellValueIsObject ? 'Cell Value' : `'${cellValue}'`;
    if (typeof cellValue !== 'undefined' && !cellValueIsObject) {
      options.push({
        label: MenuActions.FilterByValueOption.replace('{contextAction}', replaceString),
        value: MenuActions.FilterByValueOption,
      });
      options.push('sep');
    }
    if (this.state.filters.length > 0) {
      options.push(MenuActions.ClearFiltersOption);
      options.push(MenuActions.Divider);
    }

    if(cellValue) {
        try {
            if(!!cellValue.type && cellValue.type === 'Buffer') {
                const geometry = wkx.Geometry.parse(Buffer.from(cellValue.data));
                geometry.toWkt();
                options.push(MenuActions.ShowOnMap);
                this.setState({spatialDataFormat: 'binary'});
            } else {
                const geometry = wkx.Geometry.parse(cellValue);
                geometry.toWkt();
                options.push(MenuActions.ShowOnMap);
                this.setState({spatialDataFormat: 'text'});
            }
        } catch(e) {
            // check if cell value is json string and contains the spatial data in geojson format
            console.log('cell value is neither in wkt nor in wkb format. trying with geojson \n');
            try {
                const json = JSON.parse(cellValue);
                if(!!json.type && ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon',
                      'GeometryCollection'].includes(json.type)) {
                    const geometry = wkx.Geometry.parseGeoJSON(json);
                    geometry.toWkt();
                    options.push(MenuActions.ShowOnMap);
                    this.setState({spatialDataFormat: 'geoJSON'});
                }
            } catch (e) {
                console.log("cell value is not in geojson format either");
            }
        }
    }
    return options.concat([
      {
        label: MenuActions.OpenEditorWithValueOption.replace('{contextAction}', replaceString),
        value: MenuActions.OpenEditorWithValueOption,
      },
      MenuActions.OpenEditorWithRowOption,
      {
        label: MenuActions.CopyCellOption.replace('{contextAction}', replaceString),
        value: MenuActions.CopyCellOption,
      },
      MenuActions.CopyRowOption,
      MenuActions.Divider,
      MenuActions.ReRunQueryOption,
      MenuActions.SaveCSVOption,
      MenuActions.SaveJSONOption,
    ]);
  };

  renderError = (openDrawerButton: React.ReactNode) => (
    <div
      className='queryError'
      style={{
        flexGrow: 1,
        textAlign: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        display: 'flex',
        justifyContent: 'center',
        height: '100%'
      }}
    >
      <div>
        <ErrorIcon />
      </div>
      <div style={{ margin: '30px' }}>Query with errors. Please, check the error below.</div>
      <div>{openDrawerButton}</div>
    </div>
  );

  hideMap = () => this.setState({showMap: false, spatialData: null, spatialDataFormat: ''});

  downloadImage = function () {
    domtoimage.toBlob(document.getElementById('mapid'))
    .then(function (blob) {
        FileSaver.saveAs(blob, 'my-map.png');
    });
  }

  render() {
    const { rows, columns, columnNames, pageSize, openDrawerButton, error, showPagination, page, total } = this.props;
    const { filters } = this.state;
    const columnExtensions = this.state.columnExtensions || generateColumnExtensions(columnNames, rows);
    let geoJSONData = null;
    let eWKTData = null;
    let eWKBData = null;
    let extendedText = 'Extended ';
    if(this.state.showMap && this.state.spatialDataFormat && !!this.state.spatialData) {

        if(map===null){
            map = L.map('mapid');
        }

        let geometry = null;
        if(this.state.spatialDataFormat === 'binary') {
            geometry = wkx.Geometry.parse(Buffer.from(this.state.spatialData.data));
        } else if(this.state.spatialDataFormat === 'geoJSON') {
            const json = JSON.parse(this.state.spatialData);
            geometry = wkx.Geometry.parseGeoJSON(json);
        } else {
            geometry = wkx.Geometry.parse(this.state.spatialData);
        }

        geoJSONData = geometry.toGeoJSON();
        eWKTData = geometry.srid ? geometry.toEwkt() : geometry.toWkt();
        eWKBData = geometry.srid ? geometry.toEwkb() : geometry.toWkb();
        extendedText = geometry.srid ? extendedText: '';

        const vectorLayer = L.geoJSON(geoJSONData, {
            style: function (feature) {
                if (feature.properties && feature.properties.style) {
                    return feature.properties.style;
                }
		    },
        });

        vectorLayer.addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            tileSize: 512,
            zoomOffset: -1
	    }).addTo(map);

        map.setMinZoom(1);
        map.fitBounds(vectorLayer.getBounds());
    }


    return (
      <>
          <Drawer open={true} onClose={this.hideMap} style={{display: this.state.showMap ? "block" : "none",}} anchor="right" id="messages-drawer">

            <Button onClick={this.downloadImage} style={{width: "9em",}} variant="contained" color="primary">
                Save Map
            </Button>

            <List dense component="ul" subheader={<ListSubheader>MAP</ListSubheader>}>
              <ListItem component="li">
                <div id="mapid" style={{width: '100%', height: '450px'}}></div>
              </ListItem>
            </List>
            {
                !!eWKTData ?
                    <List dense component="ul" subheader={<ListSubheader>{extendedText}WKT</ListSubheader>}>
                      <ListItem component="li">
                        <ListItemText primary={eWKTData} />
                      </ListItem>
                    </List> :
                    null
            }
            {
                !!eWKBData ?
                    <List dense component="ul" subheader={<ListSubheader>{extendedText}WKB</ListSubheader>}>
                      <ListItem component="li">
                        <ListItemText primary={eWKBData} />
                      </ListItem>
                    </List> :
                    null
            }
            {
                !!geoJSONData ?
                    <List dense component="ul" subheader={<ListSubheader>GeoJSON</ListSubheader>}>
                      <ListItem component="li">
                        <pre>{JSON.stringify(geoJSONData, null, 4)}</pre>
                      </ListItem>
                    </List> :
                    null
            }
          </Drawer>
          <Paper square elevation={0} style={{ height: '100%' }}>
            {error ? (
              this.renderError(openDrawerButton)
            ) : (
              <>
                <Grid rows={rows} columns={columns} rootComponent={GridRoot}>
                  <DataTypeProvider for={columnNames} availableFilterOperations={availableFilterOperations} />
                  <SortingState />
                  <IntegratedSorting />
                  <FilteringState filters={filters} onFiltersChange={this.changeFilters} />
                  <IntegratedFiltering columnExtensions={columnExtensions} />
                  <PagingState defaultCurrentPage={page} pageSize={pageSize} />
                  <IntegratedPaging />
                  <CustomPaging
                    totalCount={total || rows.length}
                  />
                  <VirtualTable
                    height="100%"
                    cellComponent={TableCell(this.openContextMenu)}
                    rowComponent={TableRow(this.state.contextMenu.rowKey)}
                  />
                  <TableColumnResizing columnWidths={columnExtensions} onColumnWidthsChange={this.updateWidths} />
                  <TableHeaderRow showSortingControls />
                  <TableFilterRow
                    cellComponent={TableFilterRowCell}
                    showFilterSelector
                    iconComponent={FilterIcon}
                    messages={{ regex: 'RegEx' } as any}
                  />
                  {<PagingPanel containerComponent={PagingPanelContainer(openDrawerButton, showPagination)} />}
                </Grid>
                <Menu
                  open={Boolean(this.state.contextMenu.row)}
                  width={250}
                  position={this.state.contextMenu.position}
                  onSelect={this.onMenuSelect}
                  options={this.state.contextMenu.options}
                />
              </>
            )}
          </Paper>
      </>
    );
  }
}
