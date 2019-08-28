export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit }) // 在Vue的生命周期的初始化钩子之前插入
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex初始化钩子，注入到每个实例 init hooks list.
   */

  function vuexInit () {
    const options = this.$options
    // 给vue实例注入一个$store属性，这就是为什么能在组件中this.$store访问到Vuex的各种状态
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      // 如果当前的this.$options没有store，就取父级的$store
      this.$store = options.parent.$store
    }
  }
}
