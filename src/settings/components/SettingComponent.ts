import { ExtraButtonComponent, DropdownComponent, TextComponent, Setting } from 'obsidian'
import { globalSettings, GlobalSettings } from 'src/settings/filesystem'
import { Resolve } from 'src/utilities/utilities'


interface ControlComponent<T> {
  getValue(): T
  setValue(value: T): unknown
  onChange(callback: (value: T) => unknown): unknown
}

/** Every value a settings control can hold. */
type ControlValue = string | number | boolean

type Control = ControlComponent<ControlValue>

export const dropdown = (...options: [string, string][]) => ({ tag: 'dropdown' as const, options })
type dropdown = ReturnType<typeof dropdown>

export const text = (placeholder: string) => ({ tag: 'text' as const, options: { placeholder } })
type text = ReturnType<typeof text>

export const numberText = (placeholder: string) => ({ tag: 'numberText' as const, options: { placeholder } })
type numberText = ReturnType<typeof numberText>

type SettingOptions = {
  name: string,
  description?: string
  key: keyof GlobalSettings
  control: 'colorPicker' | 'toggle' | 'text' | text | 'numberText' | numberText | dropdown
}

export const SettingComponent = (options: SettingOptions) => {
  const common = () => {
    const setting = new Setting(createDiv())
      .setName(options.name)
    if (options.description) setting.setDesc(options.description)

    const controlType = typeof options.control === 'string' ? options.control : options.control.tag
    // The controls (text, number, toggle, color, dropdown) share no common
    // value type, so this one holds the union; `setValue`/`onChange` are
    // narrowed again per control below.
    let control = Resolve<Control>(resolve => ({
      text: () => setting.addText(resolve),
      numberText: () => setting.addText(resolve),
      colorPicker: () => setting.addColorPicker(resolve),
      dropdown: () => setting.addDropdown(resolve),
      toggle: () => setting.addToggle(resolve),
    })[controlType]())

    if (controlType === 'numberText') {
      const oldControl = control
      const newControl: ControlComponent<number> = Object.create(control)
      newControl.onChange = (listener: (n: number) => unknown) => {
        oldControl.onChange(value => listener(Number.parseInt(String(value))))
        return newControl
      }
      newControl.setValue = (value: number) => { oldControl.setValue(value.toString()); return newControl }
      control = newControl
    }

    type Listener<T extends ControlValue = ControlValue> = (value: T) => void
    // Listeners register with their own value type; the proxy below forwards
    // whatever the control reports, so the slot itself is typed as the union.
    let changeListener: Listener<ControlValue> | undefined
    const originalOnChange = control.onChange.bind(control)
    control.onChange = cb =>
      originalOnChange(value => {
        changeListener?.(value)
        cb(value)
      })
    // Registering narrows the listener to one control's value type, but the
    // control itself reports the union when it fires; the cast bridges the two.
    function onChange<T extends ControlValue>(listener: Listener<T>) {
      changeListener = listener as Listener<ControlValue>
    }
    const fireChangeEvent = () => changeListener?.(control.getValue())

    const result = { node: setting.settingEl, control, key: options.key, onChange, fireChangeEvent }
    if (typeof options.control !== 'object')
      return result

    // Control options:

    if (options.control.tag === 'dropdown')
      for (const [value, display] of Object.values(options.control.options))
        (control as DropdownComponent).addOption(value, display)

    if (['text', 'numberText'].includes(options.control.tag))
      (control as TextComponent).setPlaceholder((options.control.options as { placeholder: string }).placeholder)

    return result
  }

  const global = () => {
    const { node, control, key, onChange } = common()

    function update() { control.setValue(globalSettings[key])}
    update()

    control.onChange(value => {
      (globalSettings as Record<string, unknown>)[key] = value
    })

    return {
      node,
      onChange,
      update
    }
  }

  const heritable = (inheritSettings: GlobalSettings, partialSettings: Partial<GlobalSettings>) => {
    const { node, control, key, onChange, fireChangeEvent } = common()
    const { resetButton } = construct()

    function loadState() {
      const value = partialSettings[key] ?? inheritSettings[key]
      setInherit(!(key in partialSettings))
      control.setValue(value)
    }
    loadState()

    control.onChange(newValue => {
      (partialSettings as Record<string, unknown>)[key] = newValue
      setInherit(false)
    })

    resetButton.onClick(() => {
      delete partialSettings[key]
      control.setValue(inheritSettings[key])
      setInherit(true)
      fireChangeEvent()
    })

    return {
      node,
      onChange,
      update: loadState
    }

    function construct() {
      const buttonContainer = createDiv('setting-item-info advmm-reset')
      const viewActions = createDiv({ cls: 'view-actions', parent: buttonContainer })
      const resetButton = new ExtraButtonComponent(viewActions).setIcon('refresh-ccw')
      node.prepend(buttonContainer)
      return { resetButton }
    }

    function setInherit(yes: boolean) {
      if (yes) {
        node.addClass('advmm-faded')
        resetButton.extraSettingsEl.toggleVisibility(false)
      } else {
        node.removeClass('advmm-faded')
        resetButton.extraSettingsEl.toggleVisibility(true)
      }
    }
  }

  return { global, heritable }
}
