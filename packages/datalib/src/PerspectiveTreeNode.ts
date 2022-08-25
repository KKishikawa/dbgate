import {
  ColumnInfo,
  DatabaseInfo,
  ForeignKeyInfo,
  NamedObjectInfo,
  RangeDefinition,
  TableInfo,
  ViewInfo,
} from 'dbgate-types';
import {
  ChangePerspectiveConfigFunc,
  createPerspectiveNodeConfig,
  MultipleDatabaseInfo,
  PerspectiveConfig,
  PerspectiveCustomJoinConfig,
  PerspectiveFilterColumnInfo,
  PerspectiveNodeConfig,
  PerspectiveReferenceConfig,
} from './PerspectiveConfig';
import _isEqual from 'lodash/isEqual';
import _cloneDeep from 'lodash/cloneDeep';
import _compact from 'lodash/compact';
import _uniq from 'lodash/uniq';
import _flatten from 'lodash/flatten';
import _uniqBy from 'lodash/uniqBy';
import _sortBy from 'lodash/sortBy';
import _cloneDeepWith from 'lodash/cloneDeepWith';
import {
  PerspectiveDatabaseConfig,
  PerspectiveDataLoadProps,
  PerspectiveDataProvider,
} from './PerspectiveDataProvider';
import stableStringify from 'json-stable-stringify';
import { getFilterType, parseFilter } from 'dbgate-filterparser';
import { FilterType } from 'dbgate-filterparser/lib/types';
import { Condition, Expression, Select } from 'dbgate-sqltree';
import { getPerspectiveDefaultColumns } from './getPerspectiveDefaultColumns';
import uuidv1 from 'uuid/v1';

export interface PerspectiveDataLoadPropsWithNode {
  props: PerspectiveDataLoadProps;
  node: PerspectiveTreeNode;
}

// export function groupPerspectiveLoadProps(
//   ...list: PerspectiveDataLoadPropsWithNode[]
// ): PerspectiveDataLoadPropsWithNode[] {
//   const res: PerspectiveDataLoadPropsWithNode[] = [];
//   for (const item of list) {
//     const existing = res.find(
//       x =>
//         x.node == item.node &&
//         x.props.schemaName == item.props.schemaName &&
//         x.props.pureName == item.props.pureName &&
//         _isEqual(x.props.bindingColumns, item.props.bindingColumns)
//     );
//     if (existing) {
//       existing.props.bindingValues.push(...item.props.bindingValues);
//     } else {
//       res.push(_cloneDeep(item));
//     }
//   }
//   return res;
// }

export abstract class PerspectiveTreeNode {
  constructor(
    public dbs: MultipleDatabaseInfo,
    public config: PerspectiveConfig,
    public setConfig: ChangePerspectiveConfigFunc,
    public parentNode: PerspectiveTreeNode,
    public dataProvider: PerspectiveDataProvider,
    public databaseConfig: PerspectiveDatabaseConfig,
    public designerId: string
  ) {
    this.nodeConfig = config.nodes.find(x => x.designerId == designerId);
    this.parentNodeConfig = parentNode?.nodeConfig;
  }
  readonly nodeConfig: PerspectiveNodeConfig;
  readonly parentNodeConfig: PerspectiveNodeConfig;
  defaultChecked: boolean;
  abstract get title();
  abstract get codeName();
  abstract get isExpandable();
  childNodesCache: PerspectiveTreeNode[] = null;
  get childNodes(): PerspectiveTreeNode[] {
    if (!this.childNodesCache) {
      this.childNodesCache = this.generateChildNodes();
    }
    return this.childNodesCache;
  }
  abstract generateChildNodes(): PerspectiveTreeNode[];
  abstract get icon(): string;
  get fieldName() {
    return this.codeName;
  }
  get headerTableAttributes() {
    return null;
  }
  get dataField() {
    return this.codeName;
  }
  get tableCode() {
    return null;
  }
  get namedObject(): NamedObjectInfo {
    return null;
  }
  abstract getNodeLoadProps(parentRows: any[]): PerspectiveDataLoadProps;
  get isRoot() {
    return this.parentNode == null;
  }
  get rootNode(): PerspectiveTreeNode {
    if (this.isRoot) return this;
    return this.parentNode?.rootNode;
  }
  matchChildRow(parentRow: any, childRow: any): boolean {
    return true;
  }

  hasTableCode(code: string) {
    return code == this.tableCode || this.parentNode?.hasTableCode(code);
  }

  // get uniqueName() {
  //   if (this.parentNode) return `${this.parentNode.uniqueName}::${this.codeName}`;
  //   return this.codeName;
  // }
  get level() {
    if (this.parentNode) return this.parentNode.level + 1;
    return 0;
  }
  get isExpanded() {
    return this.parentNodeConfig?.expandedNodes?.includes(this.codeName);
  }
  get isChecked() {
    if (this.parentNodeConfig?.checkedNodes?.includes(this.codeName)) return true;
    if (this.parentNodeConfig?.uncheckedNodes?.includes(this.codeName)) return false;
    return this.defaultChecked;
  }
  get columnTitle() {
    return this.title;
  }
  get filterType(): FilterType {
    return 'string';
  }
  get columnName() {
    return null;
  }
  get customJoinConfig(): PerspectiveCustomJoinConfig {
    return null;
  }
  get db(): DatabaseInfo {
    return this.dbs?.[this.databaseConfig.conid]?.[this.databaseConfig.database];
  }

  getChildMatchColumns() {
    return [];
  }

  getParentMatchColumns() {
    return [];
  }

  parseFilterCondition(source = null) {
    return null;
  }

  get childDataColumn() {
    if (!this.isExpandable && this.isChecked) {
      return this.codeName;
    }
    return null;
  }

  toggleExpanded(value?: boolean) {
    this.includeInNodeSet('expandedNodes', value == null ? !this.isExpanded : value);
  }

  toggleChecked(value?: boolean) {
    if (this.defaultChecked) {
      this.includeInNodeSet('uncheckedNodes', value == null ? this.isChecked : value);
    } else {
      this.includeInNodeSet('checkedNodes', value == null ? !this.isChecked : value);
    }
  }

  createReferenceConfigColumns(): PerspectiveReferenceConfig['columns'] {
    return null;
  }

  ensureNodeConfig(cfg: PerspectiveConfig): PerspectiveConfig {
    let node = cfg.nodes.find(x => x.designerId == this.designerId);
    if (!node) {
      const nodeConfig: PerspectiveNodeConfig = {
        ...createPerspectiveNodeConfig(this.namedObject),
        isAutoGenerated: true,
      };
      const refConfig: PerspectiveReferenceConfig = {
        designerId: uuidv1(),
        sourceId: this.parentNode.designerId,
        targetId: nodeConfig.designerId,
        isAutoGenerated: true,
        columns: this.createReferenceConfigColumns(),
      };
      return {
        ...cfg,
        nodes: [...cfg.nodes, nodeConfig],
        references: [...cfg.references, refConfig],
      };
    }
    return cfg;
  }

  includeInNodeSet(field: 'expandedNodes' | 'uncheckedNodes' | 'checkedNodes', isIncluded: boolean) {
    this.setConfig(cfg => {
      const changedFields = n => ({
        ...n,
        [field]: isIncluded ? [...(n[field] || []), this.codeName] : (n[field] || []).filter(x => x != this.codeName),
      });

      cfg = this.parentNode?.ensureNodeConfig(cfg);
      if (isIncluded && field == 'expandedNodes') {
        cfg = this.ensureNodeConfig(cfg);
      }

      return {
        ...cfg,
        nodes: cfg.nodes.map(n => (n.designerId == this.parentNode?.designerId ? changedFields(n) : n)),
      };
    });
  }

  getFilter() {
    return this.parentNodeConfig?.filters?.[this.codeName];
  }

  getDataLoadColumns() {
    return _compact(
      _uniq([
        ...this.childNodes.map(x => x.childDataColumn),
        ..._flatten(this.childNodes.filter(x => x.isExpandable && x.isChecked).map(x => x.getChildMatchColumns())),
        ...this.getParentMatchColumns(),
      ])
    );
  }

  getChildrenCondition(source = null): Condition {
    const conditions = _compact([
      ...this.childNodes.map(x => x.parseFilterCondition(source)),
      ...this.buildParentFilterConditions(),
    ]);
    if (conditions.length == 0) {
      return null;
    }
    if (conditions.length == 1) {
      return conditions[0];
    }
    return {
      conditionType: 'and',
      conditions,
    };
  }

  getOrderBy(table: TableInfo | ViewInfo): PerspectiveDataLoadProps['orderBy'] {
    const res = _compact(
      this.childNodes.map(node => {
        const sort = this.parentNodeConfig?.sort?.find(x => x.columnName == node.columnName);
        if (sort) {
          return {
            columnName: node.columnName,
            order: sort.order,
          };
        }
      })
    );
    return res.length > 0
      ? res
      : (table as TableInfo)?.primaryKey?.columns.map(x => ({ columnName: x.columnName, order: 'ASC' })) || [
          { columnName: table?.columns[0].columnName, order: 'ASC' },
        ];
  }

  getBaseTables() {
    const res = [];
    const table = this.getBaseTableFromThis();
    if (table) res.push({ table, node: this });
    for (const child of this.childNodes) {
      if (!child.isChecked) continue;
      res.push(...child.getBaseTables());
    }
    return res;
  }
  getBaseTableFromThis() {
    return null;
  }

  get filterInfo(): PerspectiveFilterColumnInfo {
    return null;
  }

  findChildNodeByUniquePath(uniquePath: string[]) {
    if (uniquePath.length == 0) {
      return this;
    }
    const child = this.childNodes.find(x => x.codeName == uniquePath[0]);
    return child?.findChildNodeByUniquePath(uniquePath.slice(1));
  }

  // findNodeByUniqueName(uniqueName: string): PerspectiveTreeNode {
  //   if (!uniqueName) return null;
  //   const uniquePath = uniqueName.split('::');
  //   if (uniquePath[0] != this.codeName) return null;
  //   return this.findChildNodeByUniquePath(uniquePath.slice(1));
  // }

  findNodeByDesignerId(designerId: string): PerspectiveTreeNode {
    if (!designerId) return null;
    if (designerId == this.designerId) {
      return this;
    }

    for (const child of this.childNodes) {
      const res = child.findNodeByDesignerId(designerId);
      if (res) {
        return res;
      }
    }

    return null;
  }

  get supportsParentFilter() {
    return (
      (this.parentNode?.isRoot || this.parentNode?.supportsParentFilter) &&
      this.parentNode?.databaseConfig?.conid == this.databaseConfig?.conid &&
      this.parentNode?.databaseConfig?.database == this.databaseConfig?.database
    );
  }

  get isParentFilter() {
    return !!this.nodeConfig?.isParentFilter;
  }

  buildParentFilterConditions(): Condition[] {
    const leafNodes = _compact(
      (this.config?.nodes || [])
        .filter(x => x.isParentFilter)
        .map(x => this.rootNode.findNodeByDesignerId(x.designerId))
    );
    const conditions: Condition[] = _compact(
      leafNodes.map(leafNode => {
        if (leafNode == this) return null;
        const select: Select = {
          commandType: 'select',
          from: {
            name: leafNode.namedObject,
            alias: 'pert_0',
            relations: [],
          },
          selectAll: true,
        };
        let lastNode = leafNode;
        let node = leafNode;
        let index = 1;
        let lastAlias = 'pert_0';
        while (node?.parentNode && node?.parentNode?.designerId != this?.designerId) {
          node = node.parentNode;
          let alias = `pert_${index}`;
          select.from.relations.push({
            joinType: 'INNER JOIN',
            alias,
            name: node.namedObject,
            conditions: lastNode.getParentJoinCondition(lastAlias, alias),
          });
          lastAlias = alias;
          lastNode = node;
        }
        if (node?.parentNode?.designerId != this?.designerId) return null;
        select.where = {
          conditionType: 'and',
          conditions: _compact([
            ...lastNode.getParentJoinCondition(lastAlias, this.namedObject.pureName),
            leafNode.getChildrenCondition({ alias: 'pert_0' }),
          ]),
        };

        return {
          conditionType: 'exists',
          subQuery: select,
        };
      })
    );
    return conditions;
  }

  getParentJoinCondition(alias: string, parentAlias: string): Condition[] {
    return [];
  }
}

export class PerspectiveTableColumnNode extends PerspectiveTreeNode {
  foreignKey: ForeignKeyInfo;
  refTable: TableInfo;
  isView: boolean;
  isTable: boolean;
  constructor(
    public column: ColumnInfo,
    public table: TableInfo | ViewInfo,
    dbs: MultipleDatabaseInfo,
    config: PerspectiveConfig,
    setConfig: ChangePerspectiveConfigFunc,
    dataProvider: PerspectiveDataProvider,
    databaseConfig: PerspectiveDatabaseConfig,
    parentNode: PerspectiveTreeNode,
    designerId: string
  ) {
    super(dbs, config, setConfig, parentNode, dataProvider, databaseConfig, designerId);

    this.isTable = !!this.db?.tables?.find(x => x.schemaName == table.schemaName && x.pureName == table.pureName);
    this.isView = !!this.db?.views?.find(x => x.schemaName == table.schemaName && x.pureName == table.pureName);

    this.foreignKey = (table as TableInfo)?.foreignKeys?.find(
      fk => fk.columns.length == 1 && fk.columns[0].columnName == column.columnName
    );

    this.refTable = this.db.tables.find(
      x => x.pureName == this.foreignKey?.refTableName && x.schemaName == this.foreignKey?.refSchemaName
    );
  }

  matchChildRow(parentRow: any, childRow: any): boolean {
    if (!this.foreignKey) return false;
    return parentRow[this.foreignKey.columns[0].columnName] == childRow[this.foreignKey.columns[0].refColumnName];
  }

  getChildMatchColumns() {
    if (!this.foreignKey) return [];
    return [this.foreignKey.columns[0].columnName];
  }

  getParentMatchColumns() {
    if (!this.foreignKey) return [];
    return [this.foreignKey.columns[0].refColumnName];
  }

  getParentJoinCondition(alias: string, parentAlias: string): Condition[] {
    if (!this.foreignKey) return [];
    return this.foreignKey.columns.map(column => {
      const res: Condition = {
        conditionType: 'binary',
        operator: '=',
        left: {
          exprType: 'column',
          columnName: column.columnName,
          source: { alias: parentAlias },
        },
        right: {
          exprType: 'column',
          columnName: column.refColumnName,
          source: { alias },
        },
      };
      return res;
    });
  }

  createReferenceConfigColumns(): PerspectiveReferenceConfig['columns'] {
    return this.foreignKey?.columns?.map(col => ({
      source: col.columnName,
      target: col.refColumnName,
    }));
  }

  getNodeLoadProps(parentRows: any[]): PerspectiveDataLoadProps {
    if (!this.foreignKey) return null;
    return {
      schemaName: this.foreignKey.refSchemaName,
      pureName: this.foreignKey.refTableName,
      bindingColumns: [this.foreignKey.columns[0].refColumnName],
      bindingValues: _uniqBy(
        parentRows.map(row => [row[this.foreignKey.columns[0].columnName]]),
        stableStringify
      ),
      dataColumns: this.getDataLoadColumns(),
      databaseConfig: this.databaseConfig,
      orderBy: this.getOrderBy(this.refTable),
      condition: this.getChildrenCondition(),
    };
  }

  get icon() {
    if (this.isCircular) return 'img circular';
    if (this.column.autoIncrement) return 'img autoincrement';
    if (this.foreignKey) return 'img foreign-key';
    return 'img column';
  }

  get codeName() {
    return this.column.columnName;
  }

  get columnName() {
    return this.column.columnName;
  }

  get fieldName() {
    return this.codeName + 'Ref';
  }

  get title() {
    return this.column.columnName;
  }

  get isExpandable() {
    return !!this.foreignKey;
  }

  get filterType(): FilterType {
    return getFilterType(this.column.dataType);
  }

  get isCircular() {
    return !!this.parentNode?.parentNode?.hasTableCode(this.tableCode);
  }

  generateChildNodes(): PerspectiveTreeNode[] {
    if (!this.foreignKey) return [];
    const tbl = this?.db?.tables?.find(
      x => x.pureName == this.foreignKey?.refTableName && x.schemaName == this.foreignKey?.refSchemaName
    );

    return getTableChildPerspectiveNodes(
      tbl,
      this.dbs,
      this.config,
      this.setConfig,
      this.dataProvider,
      this.databaseConfig,
      this
    );
  }

  getBaseTableFromThis() {
    return this.refTable;
  }

  get filterInfo(): PerspectiveFilterColumnInfo {
    return {
      columnName: this.columnName,
      filterType: this.filterType,
      pureName: this.column.pureName,
      schemaName: this.column.schemaName,
      foreignKey: this.foreignKey,
    };
  }

  parseFilterCondition(source = null): Condition {
    const filter = this.getFilter();
    if (!filter) return null;
    const condition = parseFilter(filter, this.filterType);
    if (!condition) return null;
    return _cloneDeepWith(condition, (expr: Expression) => {
      if (expr.exprType == 'placeholder') {
        return {
          exprType: 'column',
          columnName: this.column.columnName,
          source,
        };
      }
    });
  }

  get headerTableAttributes() {
    if (this.foreignKey) {
      return {
        schemaName: this.foreignKey.refSchemaName,
        pureName: this.foreignKey.refTableName,
        conid: this.databaseConfig.conid,
        database: this.databaseConfig.database,
      };
    }
    return null;
  }

  get tableCode() {
    if (this.foreignKey) {
      return `${this.foreignKey.refSchemaName}|${this.foreignKey.refTableName}`;
    }
    return `${this.table.schemaName}|${this.table.pureName}`;
  }

  get namedObject(): NamedObjectInfo {
    if (this.foreignKey) {
      return {
        schemaName: this.foreignKey.refSchemaName,
        pureName: this.foreignKey.refTableName,
      };
    }
    return null;
  }
}

export class PerspectiveTableNode extends PerspectiveTreeNode {
  constructor(
    public table: TableInfo | ViewInfo,
    dbs: MultipleDatabaseInfo,
    config: PerspectiveConfig,
    setConfig: ChangePerspectiveConfigFunc,
    public dataProvider: PerspectiveDataProvider,
    databaseConfig: PerspectiveDatabaseConfig,
    parentNode: PerspectiveTreeNode,
    designerId: string
  ) {
    super(dbs, config, setConfig, parentNode, dataProvider, databaseConfig, designerId);
  }

  getNodeLoadProps(parentRows: any[]): PerspectiveDataLoadProps {
    return {
      schemaName: this.table.schemaName,
      pureName: this.table.pureName,
      dataColumns: this.getDataLoadColumns(),
      databaseConfig: this.databaseConfig,
      orderBy: this.getOrderBy(this.table),
      condition: this.getChildrenCondition(),
    };
  }

  get codeName() {
    return this.table.schemaName ? `${this.table.schemaName}:${this.table.pureName}` : this.table.pureName;
  }

  get title() {
    return this.table.pureName;
  }

  get isExpandable() {
    return true;
  }

  generateChildNodes(): PerspectiveTreeNode[] {
    return getTableChildPerspectiveNodes(
      this.table,
      this.dbs,
      this.config,
      this.setConfig,
      this.dataProvider,
      this.databaseConfig,
      this
    );
  }

  get icon() {
    return 'img table';
  }

  getBaseTableFromThis() {
    return this.table;
  }

  get headerTableAttributes() {
    return {
      schemaName: this.table.schemaName,
      pureName: this.table.pureName,
      conid: this.databaseConfig.conid,
      database: this.databaseConfig.database,
    };
  }

  get tableCode() {
    return `${this.table.schemaName}|${this.table.pureName}`;
  }

  get namedObject(): NamedObjectInfo {
    return {
      schemaName: this.table.schemaName,
      pureName: this.table.pureName,
    };
  }
}

// export class PerspectiveViewNode extends PerspectiveTreeNode {
//   constructor(
//     public view: ViewInfo,
//     dbs: MultipleDatabaseInfo,
//     config: PerspectiveConfig,
//     setConfig: ChangePerspectiveConfigFunc,
//     public dataProvider: PerspectiveDataProvider,
//     databaseConfig: PerspectiveDatabaseConfig,
//     parentNode: PerspectiveTreeNode
//   ) {
//     super(dbs, config, setConfig, parentNode, dataProvider, databaseConfig);
//   }

//   getNodeLoadProps(parentRows: any[]): PerspectiveDataLoadProps {
//     return {
//       schemaName: this.view.schemaName,
//       pureName: this.view.pureName,
//       dataColumns: this.getDataLoadColumns(),
//       databaseConfig: this.databaseConfig,
//       orderBy: this.getOrderBy(this.view),
//       condition: this.getChildrenCondition(),
//     };
//   }

//   get codeName() {
//     return this.view.schemaName ? `${this.view.schemaName}:${this.view.pureName}` : this.view.pureName;
//   }

//   get title() {
//     return this.view.pureName;
//   }

//   get isExpandable() {
//     return true;
//   }

//   get childNodes(): PerspectiveTreeNode[] {
//     return getTableChildPerspectiveNodes(
//       this.view,
//       this.dbs,
//       this.config,
//       this.setConfig,
//       this.dataProvider,
//       this.databaseConfig,
//       this
//     );
//   }

//   get icon() {
//     return 'img table';
//   }

//   getBaseTableFromThis() {
//     return this.view;
//   }
// }

export class PerspectiveTableReferenceNode extends PerspectiveTableNode {
  constructor(
    public foreignKey: ForeignKeyInfo,
    table: TableInfo,
    dbs: MultipleDatabaseInfo,
    config: PerspectiveConfig,
    setConfig: ChangePerspectiveConfigFunc,
    public dataProvider: PerspectiveDataProvider,
    databaseConfig: PerspectiveDatabaseConfig,
    public isMultiple: boolean,
    parentNode: PerspectiveTreeNode,
    designerId: string
  ) {
    super(table, dbs, config, setConfig, dataProvider, databaseConfig, parentNode, designerId);
  }

  matchChildRow(parentRow: any, childRow: any): boolean {
    if (!this.foreignKey) return false;
    return parentRow[this.foreignKey.columns[0].refColumnName] == childRow[this.foreignKey.columns[0].columnName];
  }

  getChildMatchColumns() {
    if (!this.foreignKey) return [];
    return [this.foreignKey.columns[0].refColumnName];
  }

  getParentMatchColumns() {
    if (!this.foreignKey) return [];
    return [this.foreignKey.columns[0].columnName];
  }

  getNodeLoadProps(parentRows: any[]): PerspectiveDataLoadProps {
    if (!this.foreignKey) return null;
    return {
      schemaName: this.table.schemaName,
      pureName: this.table.pureName,
      bindingColumns: [this.foreignKey.columns[0].columnName],
      bindingValues: _uniqBy(
        parentRows.map(row => [row[this.foreignKey.columns[0].refColumnName]]),
        stableStringify
      ),
      dataColumns: this.getDataLoadColumns(),
      databaseConfig: this.databaseConfig,
      orderBy: this.getOrderBy(this.table),
      condition: this.getChildrenCondition(),
    };
  }

  createReferenceConfigColumns(): PerspectiveReferenceConfig['columns'] {
    return this.foreignKey?.columns?.map(col => ({
      source: col.refColumnName,
      target: col.columnName,
    }));
  }

  get columnTitle() {
    return this.table.pureName;
  }

  get title() {
    if (this.isMultiple) {
      return `${super.title} (${this.foreignKey.columns.map(x => x.columnName).join(', ')})`;
    }
    return super.title;
  }

  get codeName() {
    if (this.isMultiple) {
      return `${super.codeName}-${this.foreignKey.columns.map(x => x.columnName).join('_')}`;
    }
    return super.codeName;
  }

  getParentJoinCondition(alias: string, parentAlias: string): Condition[] {
    if (!this.foreignKey) return [];
    return this.foreignKey.columns.map(column => {
      const res: Condition = {
        conditionType: 'binary',
        operator: '=',
        left: {
          exprType: 'column',
          columnName: column.refColumnName,
          source: { alias: parentAlias },
        },
        right: {
          exprType: 'column',
          columnName: column.columnName,
          source: { alias },
        },
      };
      return res;
    });
  }
}

export class PerspectiveCustomJoinTreeNode extends PerspectiveTableNode {
  constructor(
    public customJoin: PerspectiveCustomJoinConfig,
    table: TableInfo | ViewInfo,
    dbs: MultipleDatabaseInfo,
    config: PerspectiveConfig,
    setConfig: ChangePerspectiveConfigFunc,
    public dataProvider: PerspectiveDataProvider,
    databaseConfig: PerspectiveDatabaseConfig,
    parentNode: PerspectiveTreeNode,
    designerId: string
  ) {
    super(table, dbs, config, setConfig, dataProvider, databaseConfig, parentNode, designerId);
  }

  matchChildRow(parentRow: any, childRow: any): boolean {
    for (const column of this.customJoin.columns) {
      if (parentRow[column.baseColumnName] != childRow[column.refColumnName]) {
        return false;
      }
    }
    return true;
  }

  getChildMatchColumns() {
    return this.customJoin.columns.map(x => x.baseColumnName);
  }

  getParentMatchColumns() {
    return this.customJoin.columns.map(x => x.refColumnName);
  }

  getNodeLoadProps(parentRows: any[]): PerspectiveDataLoadProps {
    // console.log('CUSTOM JOIN', this.customJoin);
    // console.log('this.getDataLoadColumns()', this.getDataLoadColumns());
    return {
      schemaName: this.table.schemaName,
      pureName: this.table.pureName,
      bindingColumns: this.getParentMatchColumns(),
      bindingValues: _uniqBy(
        parentRows.map(row => this.customJoin.columns.map(x => row[x.baseColumnName])),
        stableStringify
      ),
      dataColumns: this.getDataLoadColumns(),
      databaseConfig: this.databaseConfig,
      orderBy: this.getOrderBy(this.table),
      condition: this.getChildrenCondition(),
    };
  }

  get title() {
    return this.customJoin.joinName;
  }

  get icon() {
    return 'icon custom-join';
  }

  get codeName() {
    return this.customJoin.joinid;
  }

  get customJoinConfig(): PerspectiveCustomJoinConfig {
    return this.customJoin;
  }

  getParentJoinCondition(alias: string, parentAlias: string): Condition[] {
    return this.customJoin.columns.map(column => {
      const res: Condition = {
        conditionType: 'binary',
        operator: '=',
        left: {
          exprType: 'column',
          columnName: column.baseColumnName,
          source: { alias: parentAlias },
        },
        right: {
          exprType: 'column',
          columnName: column.refColumnName,
          source: { alias },
        },
      };
      return res;
    });
  }
}

function findDesignerIdForNode<T extends PerspectiveTreeNode>(
  config: PerspectiveConfig,
  parentNode: PerspectiveTreeNode,
  nodeCreateFunc: (designerId: string) => T
): T {
  const node = nodeCreateFunc(null);
  const refColumns = node.createReferenceConfigColumns();
  if (!refColumns?.length) {
    return node;
  }
  const ref1 = config.references.find(
    x =>
      x.sourceId == parentNode.designerId &&
      _isEqual(
        refColumns.map(x => x.source),
        x.columns.map(x => x.source)
      ) &&
      _isEqual(
        refColumns.map(x => x.target),
        x.columns.map(x => x.target)
      )
  );
  if (ref1) return nodeCreateFunc(ref1.targetId);

  const ref2 = config.references.find(
    x =>
      x.targetId == parentNode.designerId &&
      _isEqual(
        refColumns.map(x => x.target),
        x.columns.map(x => x.source)
      ) &&
      _isEqual(
        refColumns.map(x => x.source),
        x.columns.map(x => x.target)
      )
  );
  if (ref2) return nodeCreateFunc(ref2.sourceId);

  return node;
}

export function getTableChildPerspectiveNodes(
  table: TableInfo | ViewInfo,
  dbs: MultipleDatabaseInfo,
  config: PerspectiveConfig,
  setConfig: ChangePerspectiveConfigFunc,
  dataProvider: PerspectiveDataProvider,
  databaseConfig: PerspectiveDatabaseConfig,
  parentColumn: PerspectiveTreeNode
) {
  if (!table) return [];
  const db = parentColumn.db;

  const columnNodes = table.columns.map(col =>
    findDesignerIdForNode(
      config,
      parentColumn,
      designerId =>
        new PerspectiveTableColumnNode(
          col,
          table,
          dbs,
          config,
          setConfig,
          dataProvider,
          databaseConfig,
          parentColumn,
          designerId
        )
    )
  );
  const circularColumns = columnNodes.filter(x => x.isCircular).map(x => x.columnName);
  const defaultColumns = getPerspectiveDefaultColumns(table, db, circularColumns);
  for (const node of columnNodes) {
    node.defaultChecked = defaultColumns.includes(node.columnName);
  }

  const res = [];
  res.push(...columnNodes);
  const dependencies = [];
  if (db && (table as TableInfo)?.dependencies) {
    for (const fk of (table as TableInfo)?.dependencies) {
      const tbl = db.tables.find(x => x.pureName == fk.pureName && x.schemaName == fk.schemaName);
      if (tbl) {
        const isMultiple =
          (table as TableInfo)?.dependencies.filter(x => x.pureName == fk.pureName && x.schemaName == fk.schemaName)
            .length >= 2;
        dependencies.push(
          findDesignerIdForNode(
            config,
            parentColumn,
            designerId =>
              new PerspectiveTableReferenceNode(
                fk,
                tbl,
                dbs,
                config,
                setConfig,
                dataProvider,
                databaseConfig,
                isMultiple,
                parentColumn,
                designerId
              )
          )
        );
      }
    }
  }
  res.push(..._sortBy(dependencies, 'title'));

  // const customs = [];
  // for (const join of config.customJoins || []) {
  //   if (join.baseUniqueName == parentColumn.uniqueName) {
  //     const newConfig = { ...databaseConfig };
  //     if (join.conid) newConfig.conid = join.conid;
  //     if (join.database) newConfig.database = join.database;
  //     const db = dbs?.[newConfig.conid]?.[newConfig.database];
  //     const table = db?.tables?.find(x => x.pureName == join.refTableName && x.schemaName == join.refSchemaName);
  //     const view = db?.views?.find(x => x.pureName == join.refTableName && x.schemaName == join.refSchemaName);

  //     if (table || view) {
  //       customs.push(
  //         new PerspectiveCustomJoinTreeNode(
  //           join,
  //           table || view,
  //           dbs,
  //           config,
  //           setConfig,
  //           dataProvider,
  //           newConfig,
  //           parentColumn,
  //           null
  //         )
  //       );
  //     }
  //   }
  // }
  // res.push(..._sortBy(customs, 'title'));

  return res;
}
