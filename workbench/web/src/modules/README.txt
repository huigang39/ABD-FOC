本目录：workbench/web/src/modules/

模块开发

十六个模块按 hardware、algorithm、application 分目录维护。
目录名沿用项目中的 moduleId，例如 algorithm/foc-current 是电流环。
registry.mjs 只负责显式注册与固定顺序，../core/catalog.mjs 对上层导出目录。

每个模块的 definition.mjs 是定义入口：
- id、layer、order：身份、层级与展示顺序。
- title、summary、role、inputs、outputs、boundary：界面说明与职责边界。
- dependencies、required、runtimeSwitchable、executionDomain：依赖与执行约束。
- params：参数、类型、默认值、单位、编译/初始化/运行阶段及校验边界。
- contracts.input / output / state：模块数据结构，保存在 contracts.mjs，直接参与 C 类型生成。

已有专用逻辑也放在对应目录：
- algorithm/foc-current/design.mjs：带宽计算与电流环校验。
- algorithm/foc-compensation/validation.mjs：摩擦补偿校验。
- application/app-calibration/validation.mjs：校准项目及运行许可校验。
- application/app-runtime/cia402.mjs：CiA 402 定义与校验。
- hardware/hw-platform/targets.mjs、cores.mjs：芯片内核元数据、各核参数与约束校验。
- hardware/hw-sensors/sensors.mjs、protocol.mjs：驱动通道、通信帧字段、条件显示与帧边界校验。
- view.mjs：专用界面；简单模块直接使用公共参数表单，不复制一份通用界面。

validation.mjs 汇总模块校验；presentation.mjs 注册专用视图。
公共字段构造器在 shared/fields.mjs。跨模块关系、存储几何和项目格式由外层统一检查。
浏览器路由、通知、本地保存及设备访问属于工作台外壳，模块不得直接修改这些状态。
校验函数接收 project 并返回 issues；视图接收 context 并返回 HTML，不修改传入项目。
项目中已经编辑的契约属于项目本身，改变模块默认值不覆盖这些字段。模块数据为空时可以显式载入模块字段。

新 C 实现在 workbench/native/generator/modules/，每个功能一对生成文件；配置映射在 generator/modules.mjs 和 drivers.mjs，结构渲染在 contracts.mjs。
修改数据结构后必须同步修改 C 实现及配置映射，生成检查核对字段名、类型、数组长度和单位。函数从输入读数据，向输出发布结果，持久的内部状态全部归本模块 state。
通用串行驱动仅按帧参数解析，不根据器件型号分支。请求应答按触发发送；主动上传仅初始化时发送一次启动命令，之后接收，超时只使反馈失效。
当前产物是模块库；平台端口、双核装配、Flash 和协议栈未完成前，完整固件构建保持阻止。

ABD：AI-Based Development

以模块契约为修改边界，以可执行检查作为交付依据。给 AI 一个明确模块任务即可：

“修改 modules/algorithm/foc-current。
目标：……
输入/输出/状态及单位：……
运行周期与预算：……
故障行为：……
允许修改的依赖：……
验收：……
先读取 definition.mjs、design.mjs 与关联测试，再实现并报告验证结果。”

修改参数或契约后，检查项目序列化、配置引导、依赖检查和固件参数映射。
修改专用视图时，通过 context 使用公共格式化/通知入口，保留输入转义。
新增专用校验或视图时在 validation.mjs / presentation.mjs 注册，不把业务逻辑放回 app.mjs。
不要为尚未定义的输入/输出猜造字段或把内部状态直接当作跨模块接口。

在仓库根目录运行：
  npm test
  npm run check
  npm run test:firmware  （涉及生成代码、链接或存储时）
针对单个模块可先运行 node --test workbench/test/<名称>.test.mjs。
固件代码生成与双核编译另外验证；网页参数检查通过不等于设备已验证。

当前没有调用模型 API 或自动合并 AI 修改的执行器。此目录提供可独立设计、修改、审查的模块边界。
