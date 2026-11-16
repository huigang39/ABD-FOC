/** Data layouts used by this module's generated implementation. */
export const CONTRACTS = {
  "input": {
    "name": "RecordsInput",
    "rate": "event",
    "fields": [
      {
        "id": "app-params-input-sequence",
        "name": "sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "候选记录序号"
      },
      {
        "id": "app-params-input-payload",
        "name": "payload",
        "type": "u8",
        "count": 256,
        "unit": "byte",
        "meaning": "候选记录负载"
      },
      {
        "id": "app-params-input-length",
        "name": "length",
        "type": "u16",
        "count": 1,
        "unit": "byte",
        "meaning": "有效负载长度"
      },
      {
        "id": "app-params-input-commit",
        "name": "commit",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "请求提交候选记录"
      },
      {
        "id": "app-params-input-storage_done",
        "name": "storage_done",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "存储适配器返回写入完成"
      },
      {
        "id": "app-params-input-storage_ok",
        "name": "storage_ok",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "写入后校验成功"
      }
    ]
  },
  "output": {
    "name": "RecordsOutput",
    "rate": "event",
    "fields": [
      {
        "id": "app-params-output-payload",
        "name": "payload",
        "type": "u8",
        "count": 256,
        "unit": "byte",
        "meaning": "提交给存储适配器的稳定负载"
      },
      {
        "id": "app-params-output-length",
        "name": "length",
        "type": "u16",
        "count": 1,
        "unit": "byte",
        "meaning": "记录长度"
      },
      {
        "id": "app-params-output-sequence",
        "name": "sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "记录序号"
      },
      {
        "id": "app-params-output-crc32",
        "name": "crc32",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "负载完整性校验"
      },
      {
        "id": "app-params-output-write_request",
        "name": "write_request",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "请求后台存储事务"
      },
      {
        "id": "app-params-output-committed",
        "name": "committed",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "存储确认已持久化"
      },
      {
        "id": "app-params-output-error",
        "name": "error",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "1 非法长度，2 存储失败"
      }
    ]
  },
  "state": {
    "name": "RecordsState",
    "rate": "event",
    "fields": [
      {
        "id": "app-params-state-busy",
        "name": "busy",
        "type": "bool",
        "count": 1,
        "unit": "",
        "meaning": "存在未完成存储事务"
      },
      {
        "id": "app-params-state-committed_sequence",
        "name": "committed_sequence",
        "type": "u32",
        "count": 1,
        "unit": "",
        "meaning": "最近一次完成提交的序号"
      }
    ]
  }
};
