NEO_75_H_GW_KW 最小速度闭环调试固件

适用：STM32H745IIK6，25 MHz HSE，直接 SMPS，M7 400 MHz。
功率级采用原 NEO_75_H_GW_KW 参数中的独立预驱，PE1 高电平禁止、低电平使能。
不适用 PE1 高有效的 DRV8353 SPI 版本。该版本不配置 SPI 预驱寄存器。
新板级端口尚未在实机测量 PWM/ADC 时序、闭环稳定性或保护响应。

功能
- HRTIM1 三相互补 20 kHz，500 ns 死区；ADC1/2/3 注入采样。
- USART2 / PD4、PD5、PD6 / 6.25 Mbaud；GW 外圈电机编码器，17 bit。
- 10 极对，51:1 减速器；电流环约 1 kHz 带宽，速度任务 1 kHz。
- 输出轴速度给定，限幅 ±5 rpm，斜坡 0.2 rad/s²。
- 速度 PI：Kp=5 A/(rad/s)，Ki=10 A/rad，反馈低通 20 Hz；为首版调试参数。
- 运行默认限流 2 A，可在 0–5 A 内调整；校准激励上限 5 A，过流关断 8 A。
- 只启用方向＋电角度偏置：2 s 对齐，正反各两电周扫描，稳定后取圆均值。
- 关闭 EtherCAT/CiA402、KW 力矩反馈、出轴编码器反馈、非线性校准和补偿。
- 校准结果只在 RAM 中，断电或复位后重做。上电自动采集电流零点。

镜像
HEX 包含 CM7（0x08000000）和 CM4 停驻镜像（0x08100000），要求两核默认启动地址。
这是一份独立裸机镜像，会占用原 Bootloader 地址；不能当作原应用 OTA 包。
不擦写 Bank2 的校准、参数、日志扇区。交付含两个 ELF，可用调试器加载符号。
工作台通用构建/在线调试 ABI 尚未接入此专用目标；使用本地 CLI 构建与调试器。

使用
1. 用 HEX 烧录两个镜像；加载 cm7.elf 符号。先空载调试。
2. 上电默认 command.enable=0。等待 telemetry.encoder_frames 增长，母线在 24–60 V。
3. 写 command.calibrate=1。校准中 telemetry.state=2；成功后 state=1，calibration_valid=1。
   校准会带动电机正反转，扫描段输出轴约 1.41°后回程，另有初始对齐动作；方向和偏置见 telemetry。
4. 写 command.speed_rpm=1.0（输出轴 1 rpm，对应电机 51 rpm）。
   确认 command.current_limit_a=2.0，最后写 command.enable=1，进入 state=3。
5. 写 command.enable=0 立即停止功率输出（最多一个 1 ms 外环周期）；command.cancel=1 也可停止。
6. 改 speed_rpm 可调速/反转，±5 rpm 以上被限幅。零速给定仍保持闭环。
7. 故障后先 enable=0、排除原因，再写 reset_fault=1；重新写 enable=1 才可运行。
   校准故障复位后写 calibrate=1 重做；电流零点故障需要重新上电检查。
8. 进入断点或单步前先 enable=0；不要在发波状态暂停 MCU。
   调试器暂停/重新连接可能触发周期超时或看门狗；重新复位后再观察连续运行状态。
   M7 空闲循环保持运行，以支持编码器收发及调试器实时访问；不执行 WFI。

telemetry.state：0 等待校准；1 已校准停机；2 校准中；3 速度闭环；4 故障。
telemetry.faults 位：1 ADC；2 编码器；4 电流；8 母线；16 校准；32 周期超时；64 电流零点；128 数值/命令；256 初始化。
calibration_error：1 取消/禁止；2 编码器/时基；3 方向或行程不符；4 偏置不稳定；5 超时。
编码器有效期 250 us；软件过流每 50 us 检查；独立看门狗约 100 ms。
独立预驱的硬件过流关断仍由板卡承担，本目标没有已验证的外部 trip 接线。

重建（仓库根目录 PowerShell）
$env:STM32CUBE_H7='C:\Users\huigang39\STM32Cube\Repository\STM32Cube_FW_H7_V1.13.0'
node workbench/native/build-neo-minimal.mjs
可通过 ACTUATOR_GCC_PREFIX 和 ACTUATOR_PYTHON 指定工具链与 Python。
生成源码、链接脚本、编译命令和 MAP 位于 .workbench-local/generated/<id>。
固件与配置、SHA-256 清单位于 .workbench-local/releases/NEO_75_H_GW_KW_MINIMAL_SPEED/<id>。

依据：仓库 NEO 配置参数；本机 NEO 板级资料只用于核对连线和时钟。
ST RM0399：https://www.st.com/resource/en/reference_manual/dm00176879-stm32h745-755-and-stm32h747-757-advanced-arm-based-32-bit-mcus-stmicroelectronics.pdf
STM32CubeH7 HAL/CMSIS 使用本机 SDK，不复制既有电机控制运行上下文。
